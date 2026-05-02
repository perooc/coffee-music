import { Injectable } from "@nestjs/common";
import { OrderStatus, Prisma, QueueStatus, TableStatus } from "@prisma/client";
import {
  EXTRA_SONG_CONSUMPTION_THRESHOLD,
  makeSongCredits,
  type SongCredits,
} from "@coffee-bar/shared";
import { PrismaService } from "../../database/prisma.service";

type Tx = Prisma.TransactionClient;

type Client = PrismaService | Tx;

/**
 * Sole writer for the Table read model.
 *
 * Why: Table is the operational projection (status, counters, consumption cache)
 * that fairness + UI read. Scattered writes caused drift — this service enforces
 * R1 (no external writes) and R2 (only the listed triggers mutate these fields).
 *
 * How to apply: any code that used to touch `Table.total_consumption`,
 * `active_order_count`, `pending_request_count`, `status`, `current_session_id`
 * or `last_activity_at` must call through here instead.
 */
@Injectable()
export class TableProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: Tx): Client {
    return tx ?? this.prisma;
  }

  async onSessionOpened(tableId: number, sessionId: number, tx?: Tx) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        current_session_id: sessionId,
        status: TableStatus.occupied,
        last_activity_at: new Date(),
      },
    });
  }

  async onSessionClosed(tableId: number, tx?: Tx) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        current_session_id: null,
        status: TableStatus.available,
        total_consumption: 0,
        active_order_count: 0,
        pending_request_count: 0,
        last_activity_at: new Date(),
      },
    });
  }

  async onOrderRequestCreated(tableId: number, tx?: Tx) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        pending_request_count: { increment: 1 },
        last_activity_at: new Date(),
      },
    });
  }

  async onOrderRequestAccepted(tableId: number, tx?: Tx) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        pending_request_count: { decrement: 1 },
        active_order_count: { increment: 1 },
        last_activity_at: new Date(),
      },
    });
  }

  async onOrderRequestRejected(tableId: number, tx?: Tx) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        pending_request_count: { decrement: 1 },
        last_activity_at: new Date(),
      },
    });
  }

  async onOrderLeftActive(tableId: number, tx?: Tx) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        active_order_count: { decrement: 1 },
        last_activity_at: new Date(),
      },
    });
  }

  async onConsumptionCreated(
    tableId: number,
    amount: Prisma.Decimal | number,
    tx?: Tx,
  ) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        total_consumption: { increment: amount },
        last_activity_at: new Date(),
      },
    });
  }

  async onConsumptionReversed(
    tableId: number,
    amount: Prisma.Decimal | number,
    tx?: Tx,
  ) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        total_consumption: { decrement: amount },
        last_activity_at: new Date(),
      },
    });
  }

  /**
   * Returns a wire-ready snapshot of the table to ship via socket.io. Call
   * this AFTER your transaction commits — anything fewer than the full
   * shape leaves the admin UI stuck on stale data, because the dashboard
   * merges patches over its in-memory row and a `{ id }`-only patch is a
   * no-op on the merge.
   */
  async snapshotForBroadcast(
    tableId: number,
  ): Promise<{
    id: number;
    number: number;
    qr_code: string;
    status: TableStatus;
    current_session_id: number | null;
    total_consumption: number;
    active_order_count: number;
    pending_request_count: number;
    last_activity_at: Date | null;
    current_session: {
      id: number;
      status: string;
      payment_requested_at: Date | null;
      paid_at: Date | null;
      opened_at: Date;
      song_credits: SongCredits;
    } | null;
  } | null> {
    const t = await this.prisma.table.findUnique({
      where: { id: tableId },
      include: {
        current_session: {
          select: {
            id: true,
            status: true,
            payment_requested_at: true,
            paid_at: true,
            opened_at: true,
          },
        },
      },
    });
    if (!t) return null;
    const credits = t.current_session
      ? await this.computeSongCredits(
          t.id,
          t.current_session.id,
          t.current_session.opened_at,
        )
      : makeSongCredits(0, 0);
    return {
      id: t.id,
      number: t.number,
      qr_code: t.qr_code,
      status: t.status,
      current_session_id: t.current_session_id,
      total_consumption: Number(t.total_consumption),
      active_order_count: t.active_order_count,
      pending_request_count: t.pending_request_count,
      last_activity_at: t.last_activity_at,
      current_session: t.current_session
        ? {
            id: t.current_session.id,
            status: t.current_session.status,
            payment_requested_at: t.current_session.payment_requested_at,
            paid_at: t.current_session.paid_at,
            opened_at: t.current_session.opened_at,
            song_credits: credits,
          }
        : null,
    };
  }

  /**
   * Computes the song-credit ledger for a session — how many extra-song
   * credits the table has earned (delivered orders >= threshold) vs. spent
   * (queue items flagged is_extra still counted, i.e. not skipped).
   *
   * Lives here (instead of QueueService) because the snapshot embeds it
   * and TableProjection cannot depend on QueueService without a circular
   * import. The math is intentionally cheap: two count queries.
   */
  async computeSongCredits(
    tableId: number,
    sessionId: number,
    sessionOpenedAt: Date,
  ): Promise<SongCredits> {
    const deliveredOrders = await this.prisma.order.findMany({
      where: { table_session_id: sessionId, status: OrderStatus.delivered },
      select: {
        order_items: { select: { unit_price: true, quantity: true } },
      },
    });
    let earned = 0;
    for (const order of deliveredOrders) {
      const subtotal = order.order_items.reduce(
        (acc, it) => acc + Number(it.unit_price) * it.quantity,
        0,
      );
      if (subtotal >= EXTRA_SONG_CONSUMPTION_THRESHOLD) earned += 1;
    }

    const spent = await this.prisma.queueItem.count({
      where: {
        table_id: tableId,
        is_extra: true,
        created_at: { gte: sessionOpenedAt },
        status: {
          in: [QueueStatus.pending, QueueStatus.playing, QueueStatus.played],
        },
      },
    });

    return makeSongCredits(earned, spent);
  }
}
