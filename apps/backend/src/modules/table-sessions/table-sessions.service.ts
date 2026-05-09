import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  OrderRequestStatus,
  OrderStatus,
  Prisma,
  TableSession,
  TableSessionStatus,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TableProjectionService } from "../table-projection/table-projection.service";

type Tx = Prisma.TransactionClient;

const NON_CLOSED = [
  TableSessionStatus.open,
  TableSessionStatus.ordering,
  TableSessionStatus.closing,
];

const ACTIVE_ORDER_STATUSES = [
  OrderStatus.accepted,
  OrderStatus.preparing,
  OrderStatus.ready,
];

@Injectable()
export class TableSessionsService {
  private readonly logger = new Logger(TableSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: TableProjectionService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async open(
    tableId: number,
    options: { customName?: string | null; openedBy?: "customer" | "staff" } = {},
  ): Promise<TableSession> {
    const table = await this.prisma.table.findUnique({ where: { id: tableId } });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found`);
    }

    // Multi-device sharing: when several phones at the same table reach
    // the entry view (one scans, the other types the bar code, etc.), we
    // want them all to JOIN the existing session — not each open their
    // own and auto-close the previous one. The shared session is what
    // makes the queue, the bill, and the orders feel collaborative.
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.tableSession.findFirst({
        where: { table_id: tableId, status: { in: NON_CLOSED } },
      });
      if (existing) {
        this.logger.log(
          `open(): joining existing session ${existing.id} on table ${tableId}`,
        );
        return { session: existing, isNew: false };
      }
      const created = await this.createAndProject(tableId, tx, {
        customName: options.customName ?? null,
        openedBy: options.openedBy ?? "customer",
      });
      return { session: created, isNew: true };
    });

    // Only broadcast `opened` for genuinely new sessions. Joining an
    // existing session is silent — there's no state change for other
    // listeners; the joining client will hydrate via the regular
    // session_token path.
    if (result.isNew) {
      this.realtime.emitTableSessionOpened(
        result.session.id,
        this.serialize(result.session),
      );
      const snapshot = await this.projection.snapshotForBroadcast(tableId);
      if (snapshot) this.realtime.emitTableUpdated(snapshot);
    }
    return result.session;
  }

  private async createAndProject(
    tableId: number,
    tx: Tx,
    options: { customName: string | null; openedBy: "customer" | "staff" } = {
      customName: null,
      openedBy: "customer",
    },
  ): Promise<TableSession> {
    const session = await tx.tableSession.create({
      data: {
        table_id: tableId,
        status: TableSessionStatus.open,
        custom_name: options.customName,
        opened_by: options.openedBy,
      },
    });
    await this.projection.onSessionOpened(tableId, session.id, tx);
    return session;
  }

  async close(sessionId: number): Promise<TableSession> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }
    if (session.status === TableSessionStatus.closed) {
      return session;
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      const activeOrders = await tx.order.count({
        where: {
          table_session: {
            table_id: session.table_id,
          },
          status: { in: ACTIVE_ORDER_STATUSES },
        },
      });

      if (activeOrders > 0) {
        throw new BadRequestException({
          message: "Cannot close session while there are active orders",
          code: "TABLE_SESSION_HAS_ACTIVE_ORDERS",
          active_orders: activeOrders,
        });
      }

      const updated = await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          status: TableSessionStatus.closed,
          closed_at: new Date(),
        },
      });
      await this.projection.onSessionClosed(session.table_id, tx);
      return updated;
    });

    this.realtime.emitTableSessionClosed(closed.id, this.serialize(closed));
    const snapshot = await this.projection.snapshotForBroadcast(
      session.table_id,
    );
    if (snapshot) this.realtime.emitTableUpdated(snapshot);
    return closed;
  }

  async getCurrentForTable(tableId: number): Promise<TableSession | null> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      select: { id: true, current_session_id: true },
    });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found`);
    }
    if (!table.current_session_id) return null;
    return this.prisma.tableSession.findUnique({
      where: { id: table.current_session_id },
    });
  }

  async getById(sessionId: number): Promise<TableSession> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }
    return session;
  }

  // ─── Payment flow (Phase post-H) ────────────────────────────────────────

  /**
   * Customer asks for the bill. Allowed only when:
   *   - the session exists and is not closed
   *   - paid_at is null (already paid? nothing to ask)
   *   - payment_requested_at is null (already pending? idempotent on UI but
   *     we surface a conflict so race conditions are visible)
   *   - there are NO active or pending orders/requests — anything mid-flight
   *     would mean the customer hasn't received what they ordered yet.
   *
   * Sets `payment_requested_at`. Emits a session+staff update so the admin
   * sees the toast and badge immediately.
   */
  async requestPayment(sessionId: number): Promise<TableSession> {
    const session = await this.requireSessionExists(sessionId);

    if (session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed",
        code: "TABLE_SESSION_CLOSED",
      });
    }
    if (session.paid_at) {
      throw new ConflictException({
        message: "Session is already paid",
        code: "TABLE_SESSION_ALREADY_PAID",
      });
    }
    if (session.payment_requested_at) {
      throw new ConflictException({
        message: "Payment was already requested",
        code: "TABLE_SESSION_PAYMENT_ALREADY_REQUESTED",
      });
    }

    const inFlight = await this.countInFlightOrders(sessionId);
    if (inFlight > 0) {
      throw new BadRequestException({
        message:
          "Cannot request payment while there are pending or active orders",
        code: "TABLE_SESSION_HAS_PENDING_OR_ACTIVE_ORDERS",
        in_flight: inFlight,
      });
    }

    const updated = await this.prisma.tableSession.update({
      where: { id: sessionId },
      data: { payment_requested_at: new Date() },
    });
    this.realtime.emitTableSessionUpdated(
      sessionId,
      this.serialize(updated),
    );
    return updated;
  }

  /**
   * Customer changes their mind before the admin processed the payment.
   * Forbidden once paid — at that point the bill is closed, the customer
   * cannot un-pay it.
   */
  async cancelPaymentRequest(sessionId: number): Promise<TableSession> {
    const session = await this.requireSessionExists(sessionId);
    if (session.paid_at) {
      throw new ConflictException({
        message: "Cannot cancel: payment already processed",
        code: "TABLE_SESSION_ALREADY_PAID",
      });
    }
    if (!session.payment_requested_at) {
      // Idempotent return — nothing to cancel.
      return session;
    }
    const updated = await this.prisma.tableSession.update({
      where: { id: sessionId },
      data: { payment_requested_at: null },
    });
    this.realtime.emitTableSessionUpdated(
      sessionId,
      this.serialize(updated),
    );
    return updated;
  }

  /**
   * Admin marks the bill as paid AND closes the session in a single
   * transaction. The table is reset; the next customer must scan the QR
   * to open a brand new session — no "paid but still open" intermediate
   * state exists.
   *
   * Blocks if there are active orders (preserves the `close()` safety):
   * staff shouldn't close while drinks are still being prepared.
   */
  async markPaid(sessionId: number): Promise<TableSession> {
    const session = await this.requireSessionExists(sessionId);
    if (session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed",
        code: "TABLE_SESSION_CLOSED",
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const activeOrders = await tx.order.count({
        where: {
          table_session_id: sessionId,
          status: { in: ACTIVE_ORDER_STATUSES },
        },
      });
      if (activeOrders > 0) {
        throw new BadRequestException({
          message: "Cannot close session while there are active orders",
          code: "TABLE_SESSION_HAS_ACTIVE_ORDERS",
          active_orders: activeOrders,
        });
      }

      const now = new Date();
      const updated = await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          paid_at: now,
          closed_at: now,
          status: TableSessionStatus.closed,
          payment_requested_at: null,
        },
      });
      await this.projection.onSessionClosed(session.table_id, tx);
      return updated;
    });

    this.realtime.emitTableSessionClosed(result.id, this.serialize(result));
    const snapshot = await this.projection.snapshotForBroadcast(session.table_id);
    if (snapshot) this.realtime.emitTableUpdated(snapshot);
    return result;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async requireSessionExists(sessionId: number): Promise<TableSession> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }
    return session;
  }

  /**
   * Counts orders that are not yet delivered/cancelled AND order-requests
   * that are not yet accepted/rejected/cancelled. Either kind blocks the
   * payment-request action: from the customer's point of view, "I have
   * something pending the bar".
   */
  private async countInFlightOrders(sessionId: number): Promise<number> {
    const [activeOrders, pendingRequests] = await Promise.all([
      this.prisma.order.count({
        where: {
          table_session_id: sessionId,
          status: { in: ACTIVE_ORDER_STATUSES },
        },
      }),
      this.prisma.orderRequest.count({
        where: {
          table_session_id: sessionId,
          status: OrderRequestStatus.pending,
        },
      }),
    ]);
    return activeOrders + pendingRequests;
  }

  async requireOpenForTable(tableId: number): Promise<TableSession> {
    const session = await this.getCurrentForTable(tableId);
    if (!session || session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: `Table ${tableId} has no open session`,
        code: "TABLE_SESSION_NOT_OPEN",
      });
    }
    return session;
  }

  serialize(session: TableSession) {
    return {
      ...session,
      total_consumption: Number(session.total_consumption),
    };
  }
}
