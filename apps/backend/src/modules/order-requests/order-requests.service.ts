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

type RequestItemInput = { product_id: number; quantity: number };

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

      await this.decrementStockOrThrow(tx, items);

      const order = await tx.order.create({
        data: {
          table_session_id: request.table_session_id,
          order_request_id: requestId,
          status: OrderStatus.accepted,
          order_items: {
            create: await this.buildOrderItemCreates(tx, items),
          },
        },
        include: { order_items: { include: { product: true } } },
      });

      await this.projection.onOrderRequestAccepted(
        request.table_session.table_id,
        tx,
      );

      const fresh = await tx.orderRequest.findUnique({
        where: { id: requestId },
        include: INCLUDE_FOR_SERIALIZE,
      });
      return { request: fresh!, order };
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

  private normalizeItems(items: RequestItemInput[]): RequestItemInput[] {
    const byProduct = new Map<number, number>();
    for (const item of items) {
      if (item.quantity <= 0) {
        throw new BadRequestException({
          message: "Item quantity must be positive",
          code: "ITEM_INVALID_QUANTITY",
        });
      }
      byProduct.set(
        item.product_id,
        (byProduct.get(item.product_id) ?? 0) + item.quantity,
      );
    }
    return Array.from(byProduct.entries()).map(([product_id, quantity]) => ({
      product_id,
      quantity,
    }));
  }

  private async validateProductsExistAndActive(items: RequestItemInput[]) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: items.map((i) => i.product_id) } },
      select: { id: true, name: true, is_active: true, stock: true },
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
      // Logical availability: product.stock is the upper bound; we don't reserve here.
      if (product.stock < item.quantity) {
        throw new BadRequestException({
          message: `${product.name} sin disponibilidad`,
          code: "STOCK_INSUFFICIENT",
          product_id: item.product_id,
          product_name: product.name,
        });
      }
    }
  }

  private async decrementStockOrThrow(tx: Tx, items: RequestItemInput[]) {
    for (const item of items) {
      const product = await tx.product.findUnique({
        where: { id: item.product_id },
        select: { id: true, name: true },
      });
      const result = await tx.product.updateMany({
        where: { id: item.product_id, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (result.count === 0) {
        throw new ConflictException({
          message: `${product?.name ?? `Producto ${item.product_id}`} sin disponibilidad`,
          code: "STOCK_CONFLICT",
          product_id: item.product_id,
          product_name: product?.name ?? null,
        });
      }
    }
  }

  private async buildOrderItemCreates(tx: Tx, items: RequestItemInput[]) {
    const products = await tx.product.findMany({
      where: { id: { in: items.map((i) => i.product_id) } },
      select: { id: true, price: true },
    });
    const priceById = new Map(products.map((p) => [p.id, p.price]));
    return items.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: priceById.get(item.product_id)!,
    }));
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
      return {
        product_id: Number(obj.product_id),
        quantity: Number(obj.quantity),
      };
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
