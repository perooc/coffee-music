import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  OrderRequestStatus,
  OrderStatus,
  Prisma,
  TableSessionStatus,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TableProjectionService } from "../table-projection/table-projection.service";
import { CreateOrderRequestDto } from "./dto/create-order-request.dto";

type Tx = Prisma.TransactionClient;

// ─── Input types ────────────────────────────────────────────────────────
// Una opción seleccionada dentro de un slot.
type OptionSelection = { option_id: number; quantity: number };
// Una composición de una unidad de un compuesto.
type UnitComposition = {
  slot_id: number;
  options: OptionSelection[];
};
// Una "unidad" de un item compuesto. Puede traer composición explícita
// (armable) o vacío (= usar defaults).
type UnitInput = { composition?: UnitComposition[] };

type RequestItemInput = {
  product_id: number;
  quantity?: number;
  units?: UnitInput[];
};

// ─── Resolved plan ──────────────────────────────────────────────────────
// Después de leer recetas y validar input, generamos un "plan" por
// item con la composición resuelta por unidad. Esto es lo que se
// usa para descontar stock y crear OrderItemComponent rows.
type ResolvedUnit = {
  // Componentes a descontar para esta unidad. Mapa compactado:
  // component_id -> quantity.
  components: Map<number, number>;
};
type ResolvedItem = {
  product_id: number;
  product_name: string;
  unit_price: Prisma.Decimal;
  // Si el producto es simple: units = []. El descuento es por
  // (product_id, total_quantity).
  total_quantity: number;
  // Si el producto es compuesto: una entrada por unidad. Vacío para
  // productos simples.
  composite_units: ResolvedUnit[];
};

const INCLUDE_FOR_SERIALIZE = {
  table_session: { select: { id: true, table_id: true, status: true } },
  order: {
    include: {
      order_items: { include: { product: true } },
    },
  },
} satisfies Prisma.OrderRequestInclude;

type OrderRequestFull = Prisma.OrderRequestGetPayload<{
  include: typeof INCLUDE_FOR_SERIALIZE;
}>;

@Injectable()
export class OrderRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: TableProjectionService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(dto: CreateOrderRequestDto): Promise<OrderRequestFull> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: dto.table_session_id },
      select: {
        id: true,
        table_id: true,
        status: true,
        payment_requested_at: true,
      },
    });
    if (!session) {
      throw new NotFoundException({
        message: `TableSession ${dto.table_session_id} not found`,
        code: "TABLE_SESSION_NOT_FOUND",
      });
    }
    if (session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed",
        code: "TABLE_SESSION_CLOSED",
      });
    }
    // Once the customer has asked for the bill, no new orders are
    // accepted from the customer side. (Paid sessions are already closed
    // and caught by the status check above.)
    if (session.payment_requested_at) {
      throw new BadRequestException({
        message: "Session has a pending payment request",
        code: "SESSION_PAYMENT_REQUESTED",
      });
    }

    const normalizedItems = this.normalizeItems(dto.items);
    await this.validateProductsExistAndActive(normalizedItems);

    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.orderRequest.create({
        data: {
          table_session_id: session.id,
          status: OrderRequestStatus.pending,
          items: normalizedItems as unknown as Prisma.InputJsonValue,
        },
        include: INCLUDE_FOR_SERIALIZE,
      });
      await this.projection.onOrderRequestCreated(session.table_id, tx);
      return request;
    });

    this.realtime.emitOrderRequestCreated(session.id, this.serialize(created));
    const snap = await this.projection.snapshotForBroadcast(session.table_id);
    if (snap) this.realtime.emitTableUpdated(snap);
    return created;
  }

  async accept(requestId: number): Promise<OrderRequestFull> {
    const request = await this.prisma.orderRequest.findUnique({
      where: { id: requestId },
      include: {
        table_session: { select: { id: true, table_id: true, status: true } },
      },
    });
    if (!request) {
      throw new NotFoundException(`OrderRequest ${requestId} not found`);
    }
    if (request.status !== OrderRequestStatus.pending) {
      throw new ConflictException({
        message: `OrderRequest ${requestId} is not pending (status=${request.status})`,
        code: "ORDER_REQUEST_NOT_PENDING",
      });
    }
    if (request.table_session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed",
        code: "TABLE_SESSION_CLOSED",
      });
    }

    const items = this.parseItemsFromJson(request.items);

    const result = await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.orderRequest.updateMany({
        where: { id: requestId, status: OrderRequestStatus.pending },
        data: {
          status: OrderRequestStatus.accepted,
          accepted_at: new Date(),
        },
      });
      if (guarded.count === 0) {
        throw new ConflictException({
          message: `OrderRequest ${requestId} was already handled`,
          code: "ORDER_REQUEST_RACE",
        });
      }

      // Resolver composición (puede tirar errores de validación).
      const plan = await this.resolveCompositionPlan(tx, items);
      // Descontar stock con el plan resuelto.
      await this.decrementStockOrThrow(tx, plan);

      const order = await tx.order.create({
        data: {
          table_session_id: request.table_session_id,
          order_request_id: requestId,
          status: OrderStatus.accepted,
        },
      });
      const orderItemIds = await this.createOrderItems(tx, order.id, plan);
      await this.persistComponents(tx, plan, orderItemIds);

      await this.projection.onOrderRequestAccepted(
        request.table_session.table_id,
        tx,
      );

      const freshOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: { order_items: { include: { product: true } } },
      });
      const fresh = await tx.orderRequest.findUnique({
        where: { id: requestId },
        include: INCLUDE_FOR_SERIALIZE,
      });
      return { request: fresh!, order: freshOrder! };
    });

    this.realtime.emitOrderRequestUpdated(
      request.table_session.id,
      this.serialize(result.request),
    );
    this.realtime.emitOrderCreated(
      request.table_session.id,
      this.serializeOrder(result.order),
    );
    const snap = await this.projection.snapshotForBroadcast(
      request.table_session.table_id,
    );
    if (snap) this.realtime.emitTableUpdated(snap);
    return result.request;
  }

  /**
   * Admin shortcut: create an OrderRequest and immediately accept it.
   * Used when staff adds products to a session from the dashboard —
   * those entries shouldn't appear in the "pending requests" column
   * because the staff just typed them, and they bypass the
   * "customer asked for the bill" gate (staff can still add a final
   * round even after the bill was requested).
   */
  async createAndAccept(
    dto: CreateOrderRequestDto,
  ): Promise<OrderRequestFull> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: dto.table_session_id },
      select: { id: true, table_id: true, status: true },
    });
    if (!session) {
      throw new NotFoundException({
        message: `TableSession ${dto.table_session_id} not found`,
        code: "TABLE_SESSION_NOT_FOUND",
      });
    }
    if (session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed",
        code: "TABLE_SESSION_CLOSED",
      });
    }

    const normalizedItems = this.normalizeItems(dto.items);
    await this.validateProductsExistAndActive(normalizedItems);

    // Single transaction: create as accepted from the start, decrement
    // stock, create the Order. We deliberately skip the pending →
    // accepted state machine because the customer never sees the
    // intermediate state and the staff didn't ask for it.
    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.orderRequest.create({
        data: {
          table_session_id: session.id,
          status: OrderRequestStatus.accepted,
          accepted_at: new Date(),
          items: normalizedItems as unknown as Prisma.InputJsonValue,
        },
      });

      const plan = await this.resolveCompositionPlan(tx, normalizedItems);
      await this.decrementStockOrThrow(tx, plan);

      const order = await tx.order.create({
        data: {
          table_session_id: session.id,
          order_request_id: request.id,
          status: OrderStatus.accepted,
        },
      });
      const orderItemIds = await this.createOrderItems(tx, order.id, plan);
      await this.persistComponents(tx, plan, orderItemIds);

      await this.projection.onOrderRequestAccepted(session.table_id, tx);

      const freshOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: { order_items: { include: { product: true } } },
      });
      const fresh = await tx.orderRequest.findUnique({
        where: { id: request.id },
        include: INCLUDE_FOR_SERIALIZE,
      });
      return { request: fresh!, order: freshOrder! };
    });

    this.realtime.emitOrderRequestCreated(
      session.id,
      this.serialize(result.request),
    );
    this.realtime.emitOrderCreated(
      session.id,
      this.serializeOrder(result.order),
    );
    const snap = await this.projection.snapshotForBroadcast(session.table_id);
    if (snap) this.realtime.emitTableUpdated(snap);
    return result.request;
  }

  async reject(requestId: number, reason?: string): Promise<OrderRequestFull> {
    return this.terminateRequest(
      requestId,
      OrderRequestStatus.rejected,
      reason,
    );
  }

  async cancelByCustomer(requestId: number): Promise<OrderRequestFull> {
    return this.terminateRequest(requestId, OrderRequestStatus.cancelled);
  }

  /**
   * Customer edits the items of a still-pending request. Stock is NOT
   * touched (nothing was reserved at create-time). The status guard is
   * mandatory: if admin accepted between the client's `read` and `write`,
   * `updateMany` returns 0 and we surface ORDER_REQUEST_NOT_PENDING.
   */
  async updateItems(
    requestId: number,
    items: RequestItemInput[],
  ): Promise<OrderRequestFull> {
    const request = await this.prisma.orderRequest.findUnique({
      where: { id: requestId },
      include: {
        table_session: {
          select: {
            id: true,
            table_id: true,
            status: true,
            payment_requested_at: true,
          },
        },
      },
    });
    if (!request) {
      throw new NotFoundException(`OrderRequest ${requestId} not found`);
    }
    if (request.status !== OrderRequestStatus.pending) {
      throw new ConflictException({
        message: `OrderRequest ${requestId} is not pending (status=${request.status})`,
        code: "ORDER_REQUEST_NOT_PENDING",
      });
    }
    if (request.table_session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed",
        code: "TABLE_SESSION_CLOSED",
      });
    }
    // Editing is also blocked once payment has been requested. Once paid,
    // the session is closed and the status check above already covers it.
    if (request.table_session.payment_requested_at) {
      throw new BadRequestException({
        message: "Session has a pending payment request",
        code: "SESSION_PAYMENT_REQUESTED",
      });
    }

    const normalizedItems = this.normalizeItems(items);
    await this.validateProductsExistAndActive(normalizedItems);

    const updated = await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.orderRequest.updateMany({
        where: { id: requestId, status: OrderRequestStatus.pending },
        data: {
          items: normalizedItems as unknown as Prisma.InputJsonValue,
        },
      });
      if (guarded.count === 0) {
        // Admin accepted/rejected between our read and write; surface a
        // distinct error so the UI can tell the customer to refresh.
        throw new ConflictException({
          message: `OrderRequest ${requestId} was already handled`,
          code: "ORDER_REQUEST_NOT_PENDING",
        });
      }
      return tx.orderRequest.findUnique({
        where: { id: requestId },
        include: INCLUDE_FOR_SERIALIZE,
      });
    });

    this.realtime.emitOrderRequestUpdated(
      request.table_session.id,
      this.serialize(updated!),
    );
    return updated!;
  }

  async findAll(filter?: {
    status?: OrderRequestStatus;
    tableSessionId?: number;
  }) {
    const where: Prisma.OrderRequestWhereInput = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.tableSessionId) where.table_session_id = filter.tableSessionId;
    const requests = await this.prisma.orderRequest.findMany({
      where,
      orderBy: { created_at: "desc" },
      include: INCLUDE_FOR_SERIALIZE,
    });
    return requests.map((r) => this.serialize(r));
  }

  async findOne(requestId: number) {
    const request = await this.prisma.orderRequest.findUnique({
      where: { id: requestId },
      include: INCLUDE_FOR_SERIALIZE,
    });
    if (!request) {
      throw new NotFoundException(`OrderRequest ${requestId} not found`);
    }
    return this.serialize(request);
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async terminateRequest(
    requestId: number,
    target: "rejected" | "cancelled",
    reason?: string,
  ): Promise<OrderRequestFull> {
    const request = await this.prisma.orderRequest.findUnique({
      where: { id: requestId },
      include: { table_session: { select: { id: true, table_id: true } } },
    });
    if (!request) {
      throw new NotFoundException(`OrderRequest ${requestId} not found`);
    }
    if (request.status !== OrderRequestStatus.pending) {
      throw new ConflictException({
        message: `OrderRequest ${requestId} is not pending (status=${request.status})`,
        code: "ORDER_REQUEST_NOT_PENDING",
      });
    }

    const stampField =
      target === OrderRequestStatus.rejected ? "rejected_at" : "cancelled_at";

    const updated = await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.orderRequest.updateMany({
        where: { id: requestId, status: OrderRequestStatus.pending },
        data: {
          status: target,
          [stampField]: new Date(),
          ...(target === OrderRequestStatus.rejected && reason
            ? { rejection_reason: reason }
            : {}),
        },
      });
      if (guarded.count === 0) {
        throw new ConflictException({
          message: `OrderRequest ${requestId} was already handled`,
          code: "ORDER_REQUEST_RACE",
        });
      }
      if (target === OrderRequestStatus.rejected) {
        await this.projection.onOrderRequestRejected(
          request.table_session.table_id,
          tx,
        );
      } else {
        // cancelled by customer: symmetric with reject for projection purposes
        await this.projection.onOrderRequestRejected(
          request.table_session.table_id,
          tx,
        );
      }
      return tx.orderRequest.findUnique({
        where: { id: requestId },
        include: INCLUDE_FOR_SERIALIZE,
      });
    });

    this.realtime.emitOrderRequestUpdated(
      request.table_session.id,
      this.serialize(updated!),
    );
    const snap = await this.projection.snapshotForBroadcast(
      request.table_session.table_id,
    );
    if (snap) this.realtime.emitTableUpdated(snap);
    return updated!;
  }

  /**
   * Normaliza los items del request:
   *   - Items que SOLO tienen `quantity` (sin units) y mismo product_id
   *     se colapsan sumando cantidades. Esto preserva la vieja semántica
   *     de "2 + 3 cervezas = 5 cervezas en una línea".
   *   - Items con `units` NO se colapsan: cada unidad puede tener una
   *     composición distinta y perderíamos esa info.
   *   - Valida que cada item tenga al menos `quantity` o `units`.
   */
  private normalizeItems(items: RequestItemInput[]): RequestItemInput[] {
    const simpleAggregated = new Map<number, number>();
    const compositeItems: RequestItemInput[] = [];

    for (const item of items) {
      const hasUnits = Array.isArray(item.units) && item.units.length > 0;
      const hasQuantity =
        typeof item.quantity === "number" && Number.isFinite(item.quantity);
      if (hasUnits && hasQuantity) {
        // Reglas: si vienen los dos, units.length === quantity. Lo
        // valida el service en `resolveCompositionPlan` con el contexto
        // de la receta.
      }
      if (!hasUnits && !hasQuantity) {
        throw new BadRequestException({
          message: "Item must include `quantity` or `units`",
          code: "ITEM_NO_QUANTITY",
        });
      }
      if (hasUnits) {
        compositeItems.push(item);
        continue;
      }
      // Sólo quantity → puede agruparse con otros del mismo product_id.
      const q = item.quantity!;
      if (q <= 0) {
        throw new BadRequestException({
          message: "Item quantity must be positive",
          code: "ITEM_INVALID_QUANTITY",
        });
      }
      simpleAggregated.set(
        item.product_id,
        (simpleAggregated.get(item.product_id) ?? 0) + q,
      );
    }

    const result: RequestItemInput[] = Array.from(
      simpleAggregated.entries(),
    ).map(([product_id, quantity]) => ({ product_id, quantity }));
    result.push(...compositeItems);
    return result;
  }

  /**
   * Pre-chequeo cheap: el producto existe + está activo. La
   * validación de stock real ocurre dentro de la transacción en
   * `resolveCompositionPlan` + `decrementStockOrThrow` con SELECT
   * actualizado, porque otro pedido en paralelo puede haber bajado
   * el stock entre validación y descuento. Acá sólo cortamos los
   * casos triviales rápido.
   */
  private async validateProductsExistAndActive(items: RequestItemInput[]) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: items.map((i) => i.product_id) } },
      select: { id: true, name: true, is_active: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const item of items) {
      const product = byId.get(item.product_id);
      if (!product) {
        throw new BadRequestException({
          message: `Product ${item.product_id} not found`,
          code: "PRODUCT_NOT_FOUND",
        });
      }
      if (!product.is_active) {
        throw new BadRequestException({
          message: `Product ${item.product_id} is not available`,
          code: "PRODUCT_INACTIVE",
        });
      }
    }
  }

  /**
   * Resuelve la composición de cada item para descontar stock y
   * persistir OrderItemComponent. Lee recetas con SELECT actualizado
   * dentro de la transacción para evitar race conditions con cambios
   * recientes de receta.
   *
   * Reglas:
   *   - Producto sin receta (simple): usa quantity, no units.
   *   - Producto con receta fija (todos los slots con 1 opción):
   *     quantity OK; si vienen units también, se valida.
   *   - Producto con receta armable: units recomendado. Si solo
   *     quantity, se usan defaults para todas las unidades.
   *
   * Devuelve el plan resuelto que se pasa a decrementStockOrThrow.
   */
  private async resolveCompositionPlan(
    tx: Tx,
    items: RequestItemInput[],
  ): Promise<ResolvedItem[]> {
    const productIds = items.map((i) => i.product_id);
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, price: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const slots = await tx.productRecipeSlot.findMany({
      where: { product_id: { in: productIds } },
      include: { options: true },
    });
    const slotsByProduct = new Map<number, typeof slots>();
    for (const slot of slots) {
      const arr = slotsByProduct.get(slot.product_id) ?? [];
      arr.push(slot);
      slotsByProduct.set(slot.product_id, arr);
    }

    const resolved: ResolvedItem[] = [];
    for (const item of items) {
      const product = productById.get(item.product_id);
      if (!product) {
        throw new BadRequestException({
          message: `Product ${item.product_id} not found`,
          code: "PRODUCT_NOT_FOUND",
        });
      }
      const productSlots = slotsByProduct.get(item.product_id) ?? [];
      const isComposite = productSlots.length > 0;

      // ─── Caso simple: sin receta ────────────────────────────────
      if (!isComposite) {
        if (item.units && item.units.length > 0) {
          throw new BadRequestException({
            message: `${product.name} is not a composite product`,
            code: "ITEM_UNITS_NOT_ALLOWED",
            product_id: item.product_id,
          });
        }
        const q = item.quantity ?? 0;
        if (q <= 0) {
          throw new BadRequestException({
            message: `Item quantity must be positive`,
            code: "ITEM_INVALID_QUANTITY",
          });
        }
        resolved.push({
          product_id: product.id,
          product_name: product.name,
          unit_price: product.price,
          total_quantity: q,
          composite_units: [],
        });
        continue;
      }

      // ─── Caso compuesto ─────────────────────────────────────────
      const explicitUnits = item.units;
      const totalUnits = explicitUnits?.length ?? item.quantity ?? 0;
      if (totalUnits <= 0) {
        throw new BadRequestException({
          message: `Composite item must have quantity > 0 or units[]`,
          code: "ITEM_INVALID_QUANTITY",
        });
      }
      // Si el cliente mandó ambos y no coinciden, error claro.
      if (
        explicitUnits &&
        typeof item.quantity === "number" &&
        item.quantity !== explicitUnits.length
      ) {
        throw new BadRequestException({
          message: `quantity (${item.quantity}) does not match units.length (${explicitUnits.length})`,
          code: "ITEM_QUANTITY_UNITS_MISMATCH",
        });
      }

      const composite_units: ResolvedUnit[] = [];
      for (let u = 0; u < totalUnits; u++) {
        const unitInput = explicitUnits?.[u];
        const components = new Map<number, number>();

        for (const slot of productSlots) {
          const selection = unitInput?.composition?.find(
            (c) => c.slot_id === slot.id,
          );
          // Si el cliente no especificó este slot → usar defaults.
          const optionPicks = selection
            ? selection.options
            : slot.options.map((o) => ({
                option_id: o.id,
                quantity: o.default_quantity,
              }));

          // Validar suma = slot.quantity.
          const sum = optionPicks.reduce((acc, p) => acc + p.quantity, 0);
          if (sum !== slot.quantity) {
            throw new BadRequestException({
              message: `${product.name}: slot "${slot.label}" requires exactly ${slot.quantity} units (got ${sum})`,
              code: "ITEM_SLOT_QUANTITY_MISMATCH",
              product_id: item.product_id,
              slot_id: slot.id,
            });
          }
          // Validar que cada option_id pertenezca a este slot y
          // mapear a component_id.
          const optionsById = new Map(slot.options.map((o) => [o.id, o]));
          for (const pick of optionPicks) {
            const opt = optionsById.get(pick.option_id);
            if (!opt) {
              throw new BadRequestException({
                message: `${product.name}: option ${pick.option_id} does not belong to slot "${slot.label}"`,
                code: "ITEM_INVALID_OPTION",
                product_id: item.product_id,
                slot_id: slot.id,
                option_id: pick.option_id,
              });
            }
            if (pick.quantity < 0) {
              throw new BadRequestException({
                message: `${product.name}: option quantity cannot be negative`,
                code: "ITEM_NEGATIVE_QUANTITY",
              });
            }
            if (pick.quantity === 0) continue;
            components.set(
              opt.component_id,
              (components.get(opt.component_id) ?? 0) + pick.quantity,
            );
          }
        }
        composite_units.push({ components });
      }

      resolved.push({
        product_id: product.id,
        product_name: product.name,
        unit_price: product.price,
        total_quantity: totalUnits,
        composite_units,
      });
    }
    return resolved;
  }

  /**
   * Descuenta stock siguiendo el plan resuelto. Para productos
   * simples descuenta de sí mismo; para compuestos descuenta cada
   * componente. Si algún descuento deja stock negativo, throw y la
   * transacción rollbackea.
   */
  private async decrementStockOrThrow(tx: Tx, plan: ResolvedItem[]) {
    // Agregamos todos los descuentos por component_id para hacer un
    // solo UPDATE por componente. Más eficiente y reduce ventanas de
    // race condition.
    const totals = new Map<number, number>();
    for (const item of plan) {
      if (item.composite_units.length === 0) {
        // Simple: el producto se descuenta de sí mismo.
        totals.set(
          item.product_id,
          (totals.get(item.product_id) ?? 0) + item.total_quantity,
        );
      } else {
        for (const unit of item.composite_units) {
          for (const [cid, qty] of unit.components) {
            totals.set(cid, (totals.get(cid) ?? 0) + qty);
          }
        }
      }
    }

    // Para mensajes de error, cacheamos nombres.
    const ids = Array.from(totals.keys());
    const products = await tx.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    for (const [productId, qty] of totals) {
      const result = await tx.product.updateMany({
        where: { id: productId, stock: { gte: qty } },
        data: { stock: { decrement: qty } },
      });
      if (result.count === 0) {
        throw new ConflictException({
          message: `${nameById.get(productId) ?? `Producto ${productId}`} sin disponibilidad`,
          code: "STOCK_CONFLICT",
          product_id: productId,
          product_name: nameById.get(productId) ?? null,
          required: qty,
        });
      }
    }
  }

  /**
   * Crea los OrderItem rows del plan. Devuelve un mapeo
   * product_id → order_item_id para que el caller pueda crear
   * después los OrderItemComponent rows por unidad.
   */
  private async createOrderItems(
    tx: Tx,
    orderId: number,
    plan: ResolvedItem[],
  ): Promise<Map<number, number>> {
    // Una fila por línea del plan. Para compuestos, quantity = nro
    // de unidades. Para simples, igual.
    const idsByProduct = new Map<number, number>();
    for (const item of plan) {
      const created = await tx.orderItem.create({
        data: {
          order_id: orderId,
          product_id: item.product_id,
          quantity: item.total_quantity,
          unit_price: item.unit_price,
        },
        select: { id: true },
      });
      idsByProduct.set(item.product_id, created.id);
    }
    return idsByProduct;
  }

  /**
   * Persiste los OrderItemComponent rows usando el plan. Una fila
   * por componente por unidad (unit_index identifica cuál de las N
   * unidades). Productos simples no generan filas.
   */
  private async persistComponents(
    tx: Tx,
    plan: ResolvedItem[],
    orderItemIdByProduct: Map<number, number>,
  ) {
    const creates: Prisma.OrderItemComponentCreateManyInput[] = [];
    for (const item of plan) {
      if (item.composite_units.length === 0) continue;
      const orderItemId = orderItemIdByProduct.get(item.product_id);
      if (!orderItemId) continue;
      for (let i = 0; i < item.composite_units.length; i++) {
        const unit = item.composite_units[i];
        for (const [componentId, qty] of unit.components) {
          creates.push({
            order_item_id: orderItemId,
            component_product_id: componentId,
            quantity: qty,
            unit_index: i,
          });
        }
      }
    }
    if (creates.length > 0) {
      await tx.orderItemComponent.createMany({ data: creates });
    }
  }

  /**
   * Repone stock al cancelar/rechazar un OrderRequest aceptado.
   * Usa los OrderItemComponent reales para los compuestos (suma
   * exacta) y la quantity del OrderItem para los simples. Si el
   * Order todavía no fue creado (request en pending), no hay nada
   * que reponer porque tampoco se descontó stock.
   */
  private async restoreStockFromOrder(tx: Tx, orderId: number) {
    const orderItems = await tx.orderItem.findMany({
      where: { order_id: orderId },
      include: { components: true },
    });
    const totals = new Map<number, number>();
    for (const oi of orderItems) {
      if (oi.components.length > 0) {
        for (const c of oi.components) {
          totals.set(
            c.component_product_id,
            (totals.get(c.component_product_id) ?? 0) + c.quantity,
          );
        }
      } else {
        totals.set(
          oi.product_id,
          (totals.get(oi.product_id) ?? 0) + oi.quantity,
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

  private parseItemsFromJson(raw: Prisma.JsonValue): RequestItemInput[] {
    if (!Array.isArray(raw)) {
      throw new BadRequestException({
        message: "OrderRequest items malformed",
        code: "ITEMS_MALFORMED",
      });
    }
    return raw.map((entry) => {
      const obj = entry as Record<string, unknown>;
      const result: RequestItemInput = {
        product_id: Number(obj.product_id),
      };
      // `quantity` puede estar ausente cuando el item es un compuesto
      // armable persistido con `units`. Solo lo seteamos si vino.
      if (typeof obj.quantity === "number" && Number.isFinite(obj.quantity)) {
        result.quantity = obj.quantity;
      }
      if (Array.isArray(obj.units)) {
        result.units = obj.units.map((u) => {
          const unit = u as Record<string, unknown>;
          if (Array.isArray(unit.composition)) {
            return {
              composition: unit.composition.map((c) => {
                const slot = c as Record<string, unknown>;
                return {
                  slot_id: Number(slot.slot_id),
                  options: Array.isArray(slot.options)
                    ? slot.options.map((o) => {
                        const opt = o as Record<string, unknown>;
                        return {
                          option_id: Number(opt.option_id),
                          quantity: Number(opt.quantity),
                        };
                      })
                    : [],
                };
              }),
            };
          }
          return {};
        });
      }
      return result;
    });
  }

  serialize(request: OrderRequestFull) {
    return {
      ...request,
      items: request.items,
      order: request.order
        ? this.serializeOrder(request.order)
        : null,
    };
  }

  private serializeOrder(order: {
    order_items: Array<{
      unit_price: Prisma.Decimal;
      product: { price: Prisma.Decimal } & Record<string, unknown>;
    } & Record<string, unknown>>;
  } & Record<string, unknown>) {
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
}
