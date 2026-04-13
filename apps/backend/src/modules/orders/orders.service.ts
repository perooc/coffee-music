import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { OrderStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CreateOrderDto } from "./dto/create-order.dto";

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async findAll() {
    const orders = await this.prisma.order.findMany({
      include: {
        order_items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return orders.map((order) => ({
      ...this.serializeOrder(order),
    }));
  }

  async findByTable(tableId: number) {
    const orders = await this.prisma.order.findMany({
      where: {
        table_id: tableId,
      },
      include: {
        order_items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return orders.map((order) => ({
      ...this.serializeOrder(order),
    }));
  }

  async create(createOrderDto: CreateOrderDto) {
    const { table_id, items } = createOrderDto;

    const table = await this.prisma.table.findUnique({
      where: { id: table_id },
    });

    if (!table) {
      throw new NotFoundException(`Table with ID ${table_id} not found`);
    }

    const productIds = [...new Set(items.map((item) => item.product_id))];
    const products = await this.prisma.product.findMany({
      where: {
        id: {
          in: productIds,
        },
      },
    });

    if (products.length !== productIds.length) {
      throw new NotFoundException("One or more products were not found");
    }

    const productMap = new Map(products.map((product) => [product.id, product]));

    let total = 0;
    for (const item of items) {
      const product = productMap.get(item.product_id)!;
      if (product.stock < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for product ${product.name}`,
        );
      }
      total += this.toNumber(product.price) * item.quantity;
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          table_id,
          total,
          order_items: {
            create: items.map((item) => {
              const product = productMap.get(item.product_id)!;
              return {
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: product.price,
              };
            }),
          },
        },
        include: {
          order_items: {
            include: {
              product: true,
            },
          },
        },
      });

      for (const item of items) {
        await tx.product.update({
          where: { id: item.product_id },
          data: {
            stock: {
              decrement: item.quantity,
            },
          },
        });
      }

      await tx.table.update({
        where: { id: table_id },
        data: {
          total_consumption: {
            increment: total,
          },
          status: "active",
        },
      });

      return createdOrder;
    });

    const freshOrder = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: {
        order_items: {
          include: {
            product: true,
          },
        },
      },
    });

    const freshTable = await this.prisma.table.findUnique({
      where: { id: table_id },
    });

    const serializedOrder = this.serializeOrder(freshOrder!);
    this.realtimeGateway.emitOrderUpdated(serializedOrder);

    if (freshTable) {
      this.realtimeGateway.emitTableUpdated({
        ...freshTable,
        total_consumption: this.toNumber(freshTable.total_consumption),
      });
    }

    return serializedOrder;
  }

  private static readonly VALID_TRANSITIONS: Record<string, string[]> = {
    pending: ["preparing", "cancelled"],
    preparing: ["ready", "delivered", "cancelled"],
    ready: ["delivered"],
    delivered: [],
    cancelled: [],
  };

  async updateStatus(id: number, status: OrderStatus) {
    const existingOrder = await this.prisma.order.findUnique({
      where: { id },
      include: {
        order_items: true,
      },
    });

    if (!existingOrder) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    const allowed = OrdersService.VALID_TRANSITIONS[existingOrder.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition from '${existingOrder.status}' to '${status}'`,
      );
    }

    const isCancellation = status === OrderStatus.cancelled;

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id },
        data: { status },
        include: {
          order_items: {
            include: {
              product: true,
            },
          },
        },
      });

      if (isCancellation) {
        // Restore stock
        for (const item of existingOrder.order_items) {
          await tx.product.update({
            where: { id: item.product_id },
            data: {
              stock: { increment: item.quantity },
            },
          });
        }

        // Subtract from table consumption
        await tx.table.update({
          where: { id: existingOrder.table_id },
          data: {
            total_consumption: {
              decrement: this.toNumber(existingOrder.total),
            },
          },
        });
      }

      return order;
    });

    const serializedOrder = this.serializeOrder(updatedOrder);
    this.realtimeGateway.emitOrderUpdated(serializedOrder);

    if (isCancellation) {
      const freshTable = await this.prisma.table.findUnique({
        where: { id: existingOrder.table_id },
      });
      if (freshTable) {
        this.realtimeGateway.emitTableUpdated({
          ...freshTable,
          total_consumption: this.toNumber(freshTable.total_consumption),
        });
      }
    }

    return serializedOrder;
  }

  private toNumber(value: Prisma.Decimal | number) {
    return Number(value);
  }

  private serializeOrder(
    order: Prisma.OrderGetPayload<{
      include: { order_items: { include: { product: true } } };
    }>,
  ) {
    return {
      ...order,
      total: this.toNumber(order.total),
      order_items: order.order_items.map((item) => ({
        ...item,
        unit_price: this.toNumber(item.unit_price),
        product: {
          ...item.product,
          price: this.toNumber(item.product.price),
        },
      })),
    };
  }
}
