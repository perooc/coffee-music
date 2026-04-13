import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Table } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

const tableListInclude = {
  _count: {
    select: {
      orders: true,
      queue_items: true,
      songs: true,
    },
  },
} satisfies Prisma.TableInclude;

const tableDetailInclude = {
  songs: {
    orderBy: {
      created_at: "desc",
    },
  },
  queue_items: {
    include: {
      song: true,
    },
    orderBy: {
      position: "asc",
    },
  },
  orders: {
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
  },
  _count: {
    select: {
      orders: true,
      queue_items: true,
      songs: true,
    },
  },
} satisfies Prisma.TableInclude;

type TableListRecord = Prisma.TableGetPayload<{ include: typeof tableListInclude }>;
type TableDetailRecord = Prisma.TableGetPayload<{ include: typeof tableDetailInclude }>;

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const tables = await this.prisma.table.findMany({
      include: tableListInclude,
      orderBy: {
        id: "asc",
      },
    });

    return tables.map((table) => this.serializeTableList(table));
  }

  async findOne(id: number) {
    const table = await this.prisma.table.findUnique({
      where: { id },
      include: tableDetailInclude,
    });

    if (!table) {
      throw new NotFoundException(`Table with ID ${id} not found`);
    }

    return this.serializeTableDetail(table);
  }

  private serializeTable(table: Table) {
    return {
      ...table,
      total_consumption: this.toNumber(table.total_consumption),
    };
  }

  private serializeTableList(table: TableListRecord) {
    return {
      ...this.serializeTable(table),
      _count: table._count,
    };
  }

  private serializeTableDetail(table: TableDetailRecord) {
    return {
      ...this.serializeTable(table),
      songs: table.songs.map((song) => ({
        ...song,
      })),
      queue_items: table.queue_items.map((queueItem) => ({
        ...queueItem,
        priority_score: this.toNumber(queueItem.priority_score),
      })),
      orders: table.orders.map((order) => ({
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
      })),
      _count: table._count,
    };
  }

  private toNumber(value: Prisma.Decimal | number) {
    return Number(value);
  }
}
