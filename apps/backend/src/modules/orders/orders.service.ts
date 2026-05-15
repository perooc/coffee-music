import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ConsumptionType,
  Order,
  OrderStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { ConsumptionsService } from "../consumptions/consumptions.service";
import { ProductsService } from "../products/products.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TableProjectionService } from "../table-projection/table-projection.service";

type Tx = Prisma.TransactionClient;

const ORDER_INCLUDE = {
  order_items: {
    include: {
      product: true,
      // Componentes físicos para productos compuestos. Vacío para
      // simples. Usado por restoreStock para reposición exacta.
      components: true,
    },
  },
  table_session: { select: { id: true, table_id: true, status: true } },
} satisfies Prisma.OrderInclude;

type OrderFull = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.accepted,
  OrderStatus.preparing,
  OrderStatus.ready,
];

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // Direct accepted→delivered is the default UI flow today (single
  // "ENTREGAR" button); the legacy preparing / ready intermediates remain
  // valid so we can re-enable a kitchen-screen flow without a migration.
  [OrderStatus.accepted]: [
    OrderStatus.delivered,
    OrderStatus.preparing,
    OrderStatus.cancelled,
  ],
  [OrderStatus.preparing]: [OrderStatus.ready, OrderStatus.cancelled],
  [OrderStatus.ready]: [OrderStatus.delivered, OrderStatus.cancelled],
  [OrderStatus.delivered]: [],
  [OrderStatus.cancelled]: [],
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: TableProjectionService,
    private readonly realtime: RealtimeGateway,
    private readonly consumptions: ConsumptionsService,
    private readonly products: ProductsService,
  ) {}

  async findAll(filter?: {
    status?: OrderStatus;
    tableSessionId?: number;
  }): Promise<OrderFull[]> {
    const where: Prisma.OrderWhereInput = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.tableSessionId)
      where.table_session_id = filter.tableSessionId;
    const orders = await this.prisma.order.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { created_at: "desc" },
    });
    return orders;
  }

  async findOne(id: number): Promise<OrderFull> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  async updateStatus(
    id: number,
    nextStatus: OrderStatus,
  ): Promise<OrderFull> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        // `components` viaja con cada order_item para que la cancelación
        // de compuestos arme el plan exacto de reposición (sin esto la
        // cancelación de un cubetazo mix no devolvía las cervezas reales
        // — caía en el fallback de simple y trataba de sumar al stock
        // del propio compuesto, que no se descuenta nunca).
        order_items: { include: { components: true } },
        table_session: { select: { id: true, table_id: true } },
      },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    const allowed = TRANSITIONS[order.status];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException({
        message: `Invalid transition ${order.status} -> ${nextStatus}`,
        code: "ORDER_INVALID_TRANSITION",
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.order.updateMany({
        where: { id, status: order.status },
        data: this.transitionData(nextStatus),
      });
      if (guarded.count === 0) {
        throw new ConflictException({
          message: `Order ${id} was modified concurrently`,
          code: "ORDER_RACE",
        });
      }

      if (nextStatus === OrderStatus.delivered) {
        await this.emitConsumptions(tx, order);
        await this.projection.onOrderLeftActive(
          order.table_session.table_id,
          tx,
        );
      } else if (nextStatus === OrderStatus.cancelled) {
        await this.restoreStock(tx, order.order_items);
        await this.projection.onOrderLeftActive(
          order.table_session.table_id,
          tx,
        );
      }

      const fresh = await tx.order.findUnique({
        where: { id },
        include: ORDER_INCLUDE,
      });
      return fresh!;
    });

    this.realtime.emitOrderUpdated(
      order.table_session_id,
      this.serialize(result),
    );
    const snap = await this.projection.snapshotForBroadcast(
      order.table_session.table_id,
    );
    if (snap) this.realtime.emitTableUpdated(snap);
    if (nextStatus === OrderStatus.delivered) {
      await this.consumptions.emitBillSnapshot(
        order.table_session_id,
        order.table_session.table_id,
      );
    }
    // Tras una cancelación se repuso stock; broadcasteamos los productos
    // afectados (incluye compuestos que dependen de los componentes
    // repuestos) para que la mesa y la grilla admin se actualicen sin
    // recargar la página.
    if (nextStatus === OrderStatus.cancelled) {
      const ids = this.collectAffectedProductIds(order.order_items);
      void this.products.broadcastChanged(ids);
    }
    return result;
  }

  private collectAffectedProductIds(
    items: Array<{
      product_id: number;
      components?: Array<{ component_product_id: number }>;
    }>,
  ): number[] {
    const ids = new Set<number>();
    for (const it of items) {
      ids.add(it.product_id);
      for (const c of it.components ?? []) ids.add(c.component_product_id);
    }
    return Array.from(ids);
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private transitionData(next: OrderStatus): Prisma.OrderUncheckedUpdateInput {
    const now = new Date();
    const data: Prisma.OrderUncheckedUpdateInput = { status: next };
    if (next === OrderStatus.delivered) data.delivered_at = now;
    if (next === OrderStatus.cancelled) data.cancelled_at = now;
    return data;
  }

  /**
   * Repone stock al cancelar un Order. Para productos compuestos
   * usa los OrderItemComponent reales (los componentes físicos que
   * efectivamente salieron); para simples usa quantity del OrderItem.
   * Esto garantiza reversión exacta — si una venta fue "3 aguila +
   * 3 poker" en un armable, repone exactamente eso, no el default.
   */
  private async restoreStock(
    tx: Tx,
    items: Array<{
      id: number;
      product_id: number;
      quantity: number;
      components?: Array<{ component_product_id: number; quantity: number }>;
    }>,
  ) {
    // Recopilar componentes a reponer aparte para hacer un solo
    // update por componente.
    const totals = new Map<number, number>();
    for (const item of items) {
      // Si llegó con components, es un compuesto: reponer
      // exactamente esos componentes.
      const fromComponents = item.components ?? [];
      if (fromComponents.length > 0) {
        for (const c of fromComponents) {
          totals.set(
            c.component_product_id,
            (totals.get(c.component_product_id) ?? 0) + c.quantity,
          );
        }
      } else {
        // Producto simple: reponer al mismo product_id.
        totals.set(
          item.product_id,
          (totals.get(item.product_id) ?? 0) + item.quantity,
        );
      }
    }
    for (const [productId, qty] of totals) {
      await tx.product.update({
        where: { id: productId },
        data: { stock: { increment: qty } },
      });
    }
  }

  private async emitConsumptions(
    tx: Tx,
    order: Order & {
      order_items: Array<{
        product_id: number;
        quantity: number;
        unit_price: Prisma.Decimal;
      }>;
      table_session: { table_id: number };
    },
  ) {
    const products = await tx.product.findMany({
      where: { id: { in: order.order_items.map((i) => i.product_id) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    let totalDelta = new Prisma.Decimal(0);

    for (const item of order.order_items) {
      const amount = new Prisma.Decimal(item.unit_price).mul(item.quantity);
      totalDelta = totalDelta.add(amount);
      await tx.consumption.create({
        data: {
          table_session_id: order.table_session_id,
          order_id: order.id,
          product_id: item.product_id,
          description: nameById.get(item.product_id) ?? `Product ${item.product_id}`,
          quantity: item.quantity,
          unit_amount: item.unit_price,
          amount,
          type: ConsumptionType.product,
        },
      });
    }

    await tx.tableSession.update({
      where: { id: order.table_session_id },
      data: {
        total_consumption: { increment: totalDelta },
        last_consumption_at: new Date(),
      },
    });

    await this.projection.onConsumptionCreated(
      order.table_session.table_id,
      totalDelta,
      tx,
    );
  }

  serialize(order: OrderFull) {
    return {
      ...order,
      order_items: order.order_items.map((item) => ({
        ...item,
        unit_price: Number(item.unit_price),
        product: {
          ...item.product,
          price: Number(item.product.price),
        },
      })),
    };
  }

  static readonly ACTIVE_STATUSES = ACTIVE_STATUSES;
  static readonly TRANSITIONS = TRANSITIONS;
}
