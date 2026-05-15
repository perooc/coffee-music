import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Consumption,
  ConsumptionType,
  Prisma,
  TableSessionStatus,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { ProductsService } from "../products/products.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TableProjectionService } from "../table-projection/table-projection.service";
import {
  AdjustmentKind,
  CreateAdjustmentDto,
} from "./dto/create-adjustment.dto";
import { RefundConsumptionDto } from "./dto/refund-consumption.dto";

/**
 * The authenticated staff/admin acting on the ledger. When provided, the
 * service ignores any `created_by` sent in the DTO: the body is never trusted
 * as a source of audit truth once there is a user behind the token.
 */
export type AuditActor = {
  user_id: number;
  name: string;
} | null;

const CONSUMPTION_INCLUDE = {
  order: { select: { id: true, status: true } },
  reverses: { select: { id: true, description: true, amount: true, type: true } },
} satisfies Prisma.ConsumptionInclude;

type ConsumptionFull = Prisma.ConsumptionGetPayload<{
  include: typeof CONSUMPTION_INCLUDE;
}>;

export type BillSummary = {
  subtotal: number;
  discounts_total: number;
  adjustments_total: number;
  // Sum of negative `partial_payment` rows. Stored as a negative
  // number so the UI can show "Pagado parcial: -$50.000" without
  // needing to invert the sign on read.
  partial_payments_total: number;
  total: number;
  item_count: number;
};

export type BillView = {
  session_id: number;
  table_id: number;
  status: TableSessionStatus;
  opened_at: Date;
  closed_at: Date | null;
  last_consumption_at: Date | null;
  summary: BillSummary;
  items: ReturnType<ConsumptionsService["serialize"]>[];
};

@Injectable()
export class ConsumptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: TableProjectionService,
    private readonly realtime: RealtimeGateway,
    private readonly products: ProductsService,
  ) {}

  async getBill(sessionId: number): Promise<BillView> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        table_id: true,
        status: true,
        opened_at: true,
        closed_at: true,
        last_consumption_at: true,
      },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }

    const items = await this.prisma.consumption.findMany({
      where: { table_session_id: sessionId },
      include: CONSUMPTION_INCLUDE,
      orderBy: { created_at: "asc" },
    });

    return {
      session_id: session.id,
      table_id: session.table_id,
      status: session.status,
      opened_at: session.opened_at,
      closed_at: session.closed_at,
      last_consumption_at: session.last_consumption_at,
      summary: this.summarize(items),
      items: items.map((c) => this.serialize(c)),
    };
  }

  async createAdjustment(
    sessionId: number,
    dto: CreateAdjustmentDto,
    actor: AuditActor = null,
  ): Promise<ConsumptionFull> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }
    if (session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed; adjustments are not allowed",
        code: "TABLE_SESSION_CLOSED",
      });
    }

    // Sign rules:
    //   discount -> always negative (server forces sign if client sent positive).
    //   adjustment -> free ± sign.
    let amount = dto.amount;
    if (dto.type === AdjustmentKind.discount && amount > 0) {
      amount = -amount;
    }
    if (dto.type === AdjustmentKind.discount && amount >= 0) {
      throw new BadRequestException({
        message: "Discount amount must be non-zero",
        code: "DISCOUNT_INVALID_AMOUNT",
      });
    }

    const type =
      dto.type === AdjustmentKind.discount
        ? ConsumptionType.discount
        : ConsumptionType.adjustment;
    const description = this.describeAdjustment(type, dto.reason);

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.consumption.create({
        data: {
          table_session_id: sessionId,
          description,
          quantity: 1,
          unit_amount: amount,
          amount,
          type,
          reason: dto.reason,
          notes: dto.notes ?? null,
          // Audit rule: server is the single source of truth. The DTO does
          // not even expose `created_by` anymore (Phase G7) — only an
          // authenticated actor can stamp it. Internal callers (seeds,
          // scripts) write null, which is the honest answer.
          created_by: actor?.name ?? null,
        },
        include: CONSUMPTION_INCLUDE,
      });
      await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          total_consumption: { increment: amount },
          last_consumption_at: new Date(),
        },
      });
      if (amount >= 0) {
        await this.projection.onConsumptionCreated(session.table_id, amount, tx);
      } else {
        await this.projection.onConsumptionReversed(
          session.table_id,
          Math.abs(amount),
          tx,
        );
      }
      return created;
    });

    this.emitBillUpdates(sessionId, session.table_id);
    return result;
  }

  /**
   * Customer pays part of the bill mid-session. Stored as a Consumption
   * with negative amount and type = partial_payment, so:
   *   - the bill's running total naturally drops by `amount` (= remaining
   *     to pay) without changing the sum-of-items reducer above;
   *   - the customer-facing receipt lists "Pago parcial — $X" as a line
   *     item, in chronological position;
   *   - real revenue accounting upstream still treats every partial as
   *     revenue at the moment it lands (the `amount` is mirrored into
   *     reports the same way other consumption rows are).
   *
   * Refused on closed sessions: a closed session is meant to be
   * append-only history. Use refundConsumption to undo a wrong partial.
   */
  async recordPartialPayment(
    sessionId: number,
    rawAmount: number,
    actor: AuditActor = null,
  ): Promise<ConsumptionFull> {
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException({
        message: "El monto del pago parcial debe ser positivo",
        code: "PARTIAL_PAYMENT_INVALID_AMOUNT",
      });
    }

    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }
    if (session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed; partial payments are not allowed",
        code: "TABLE_SESSION_CLOSED",
      });
    }

    // Block over-payment: the cashier shouldn't accidentally record a
    // partial bigger than what's left to pay. We re-read the bill total
    // (which already nets out previous partials) and refuse if amount
    // would push it negative. Equality is allowed — paying the exact
    // remaining is fine; staff just won't normally use partial-payment
    // for that, they use "Cobrar y cerrar".
    const pending = Number(session.total_consumption);
    if (amount > pending + 0.001) {
      throw new BadRequestException({
        message: `El pago supera el pendiente ($${pending}). Usa "Cobrar y cerrar" para liquidar.`,
        code: "PARTIAL_PAYMENT_EXCEEDS_PENDING",
      });
    }

    // Stored as negative so the existing sum reducer turns "total
    // consumption" into "remaining to pay" without special-casing.
    const negative = -this.round(amount);

    const description = `Pago parcial — ${this.formatCurrency(amount)}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.consumption.create({
        data: {
          table_session_id: sessionId,
          description,
          quantity: 1,
          unit_amount: negative,
          amount: negative,
          type: ConsumptionType.partial_payment,
          // No reason/notes: the description is the receipt's voice;
          // upstream audit log already records actor + timestamp.
          created_by: actor?.name ?? null,
        },
        include: CONSUMPTION_INCLUDE,
      });
      await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          total_consumption: { increment: negative },
          last_consumption_at: new Date(),
        },
      });
      // The pending pesos drop by `amount`. Treat it as a reversal in
      // the projection so "total_consumption" on the table tile mirrors
      // what the customer sees.
      await this.projection.onConsumptionReversed(
        session.table_id,
        new Prisma.Decimal(amount),
        tx,
      );
      return created;
    });

    this.emitBillUpdates(sessionId, session.table_id);
    return result;
  }

  private formatCurrency(n: number): string {
    // Receipt label only — the bill UI re-formats with locale rules.
    // We just want a sane "$123.456" in the description column.
    try {
      return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }).format(n);
    } catch {
      return `$${n}`;
    }
  }

  async refundConsumption(
    consumptionId: number,
    dto: RefundConsumptionDto,
    actor: AuditActor = null,
  ): Promise<ConsumptionFull> {
    const original = await this.prisma.consumption.findUnique({
      where: { id: consumptionId },
      include: {
        table_session: {
          select: { id: true, table_id: true, status: true },
        },
      },
    });
    if (!original) {
      throw new NotFoundException(`Consumption ${consumptionId} not found`);
    }
    if (original.type === ConsumptionType.refund) {
      throw new BadRequestException({
        message: "Cannot refund a refund entry",
        code: "REFUND_INVALID_TARGET",
      });
    }
    if (original.reversed_at) {
      throw new ConflictException({
        message: `Consumption ${consumptionId} is already reversed`,
        code: "CONSUMPTION_ALREADY_REVERSED",
      });
    }
    if (original.table_session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed; refunds are not allowed",
        code: "TABLE_SESSION_CLOSED",
      });
    }

    const refundAmount = new Prisma.Decimal(original.amount).neg();
    // Default true: reponer stock al revertir. Solo se omite si el
    // operador marca explícitamente que el producto no se recupera
    // físicamente (rotura, derrame, ya consumido).
    const restoreStock = dto.restore_stock !== false;

    const result = await this.prisma.$transaction(async (tx) => {
      const marked = await tx.consumption.updateMany({
        where: { id: consumptionId, reversed_at: null },
        data: { reversed_at: new Date() },
      });
      if (marked.count === 0) {
        throw new ConflictException({
          message: `Consumption ${consumptionId} was already reversed concurrently`,
          code: "CONSUMPTION_ALREADY_REVERSED",
        });
      }

      const created = await tx.consumption.create({
        data: {
          table_session_id: original.table_session_id,
          order_id: original.order_id,
          product_id: original.product_id,
          description: `Refund: ${original.description}`,
          quantity: original.quantity,
          unit_amount: new Prisma.Decimal(original.unit_amount).neg(),
          amount: refundAmount,
          type: ConsumptionType.refund,
          reverses_id: consumptionId,
          reason: dto.reason,
          notes: dto.notes ?? null,
          // Audit rule: see createAdjustment.
          created_by: actor?.name ?? null,
        },
        include: CONSUMPTION_INCLUDE,
      });

      await tx.tableSession.update({
        where: { id: original.table_session_id },
        data: {
          total_consumption: { increment: refundAmount },
          last_consumption_at: new Date(),
        },
      });
      await this.projection.onConsumptionReversed(
        original.table_session.table_id,
        new Prisma.Decimal(original.amount),
        tx,
      );

      // Reponer stock cuando aplica. Buscamos el OrderItem y sus
      // componentes (compuestos) o el product_id directo (simples).
      let affected: number[] = [];
      if (restoreStock && original.order_id && original.product_id) {
        affected = await this.restoreStockForRefund(
          tx,
          original.order_id,
          original.product_id,
          original.quantity,
        );
      }

      return { created, affected };
    });

    this.emitBillUpdates(
      original.table_session_id,
      original.table_session.table_id,
    );
    if (result.affected.length > 0) {
      void this.products.broadcastChanged(result.affected);
    }
    return result.created;
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private describeAdjustment(type: ConsumptionType, reason: string): string {
    const label = type === ConsumptionType.discount ? "Discount" : "Adjustment";
    return `${label}: ${reason}`;
  }

  private summarize(items: Consumption[]): BillSummary {
    let subtotal = 0;
    let discounts = 0;
    let adjustments = 0;
    let partials = 0;
    for (const item of items) {
      const n = Number(item.amount);
      switch (item.type) {
        case ConsumptionType.product:
          subtotal += n;
          break;
        case ConsumptionType.discount:
          discounts += n;
          break;
        case ConsumptionType.adjustment:
        case ConsumptionType.refund:
          adjustments += n;
          break;
        case ConsumptionType.partial_payment:
          partials += n;
          break;
      }
    }
    return {
      subtotal: this.round(subtotal),
      discounts_total: this.round(discounts),
      adjustments_total: this.round(adjustments),
      partial_payments_total: this.round(partials),
      total: this.round(subtotal + discounts + adjustments + partials),
      item_count: items.length,
    };
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /**
   * Repone stock al hacer refund sobre una venta concreta. Busca el
   * OrderItem que coincide con (order_id, product_id) y:
   *   - Si tiene OrderItemComponent rows → repone los componentes
   *     en las cantidades exactas que se descontaron al aceptar.
   *   - Si NO tiene componentes (producto simple) → repone el propio
   *     producto en `consumptionQuantity` unidades.
   *
   * Idempotencia: NO marcamos los OrderItemComponent como
   * "ya repuestos". Un refund doble del mismo Consumption ya está
   * bloqueado por el check `reversed_at != null` arriba, así que
   * acá no hay riesgo de reponer dos veces.
   */
  private async restoreStockForRefund(
    tx: Prisma.TransactionClient,
    orderId: number,
    productId: number,
    consumptionQuantity: number,
  ): Promise<number[]> {
    const affected = new Set<number>();
    const orderItem = await tx.orderItem.findFirst({
      where: { order_id: orderId, product_id: productId },
      include: { components: true },
    });
    if (!orderItem) {
      await tx.product.update({
        where: { id: productId },
        data: { stock: { increment: consumptionQuantity } },
      });
      affected.add(productId);
      return Array.from(affected);
    }
    if (orderItem.components.length > 0) {
      const ratio = consumptionQuantity / orderItem.quantity;
      const totals = new Map<number, number>();
      for (const c of orderItem.components) {
        const restore = Math.round(c.quantity * ratio);
        totals.set(
          c.component_product_id,
          (totals.get(c.component_product_id) ?? 0) + restore,
        );
      }
      for (const [componentId, qty] of totals) {
        if (qty > 0) {
          await tx.product.update({
            where: { id: componentId },
            data: { stock: { increment: qty } },
          });
          affected.add(componentId);
        }
      }
      // El producto compuesto en sí no cambió stock, pero incluirlo
      // ayuda a que la grilla admin lo recomponga (la availability sí
      // puede haber cambiado).
      affected.add(productId);
    } else {
      await tx.product.update({
        where: { id: productId },
        data: { stock: { increment: consumptionQuantity } },
      });
      affected.add(productId);
    }
    return Array.from(affected);
  }

  async emitBillSnapshot(sessionId: number, tableId: number) {
    const bill = await this.getBill(sessionId);
    this.realtime.emitBillUpdated(sessionId, bill);
    this.realtime.emitTableSessionUpdated(sessionId, {
      id: sessionId,
      total_consumption: bill.summary.total,
    });
    const snapshot = await this.projection.snapshotForBroadcast(tableId);
    if (snapshot) this.realtime.emitTableUpdated(snapshot);
  }

  private async emitBillUpdates(sessionId: number, tableId: number) {
    await this.emitBillSnapshot(sessionId, tableId);
  }

  serialize(consumption: ConsumptionFull) {
    return {
      ...consumption,
      unit_amount: Number(consumption.unit_amount),
      amount: Number(consumption.amount),
      reverses: consumption.reverses
        ? { ...consumption.reverses, amount: Number(consumption.reverses.amount) }
        : null,
    };
  }
}
