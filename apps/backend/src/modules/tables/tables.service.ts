import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Table } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { UpdateTableDto } from "./dto/update-table.dto";

const tableListInclude = {
  _count: {
    select: {
      queue_items: true,
      songs: true,
    },
  },
  // Embed the session's payment flags so the admin dashboard can render
  // "Pidió cuenta" / "Pagada" badges without a second round-trip per row.
  current_session: {
    select: {
      id: true,
      status: true,
      payment_requested_at: true,
      paid_at: true,
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
  current_session: {
    include: {
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
    },
  },
  _count: {
    select: {
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
      include: tableListInclude,
    });

    if (!table) {
      throw new NotFoundException(`Table with ID ${id} not found`);
    }

    return this.serializeTableList(table);
  }

  async findOneDetailed(id: number) {
    const table = await this.prisma.table.findUnique({
      where: { id },
      include: tableDetailInclude,
    });

    if (!table) {
      throw new NotFoundException(`Table with ID ${id} not found`);
    }

    return this.serializeTableDetail(table);
  }

  async updateStatus(id: number, updateTableDto: UpdateTableDto) {
    const table = await this.prisma.table.update({
      where: { id },
      data: {
        status: updateTableDto.status,
      },
      include: tableListInclude,
    });

    return this.serializeTableList(table);
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
      // Expose only the session's payment-related flags. The full session
      // shape lives behind /table-sessions/:id for the admin bill drawer.
      current_session: table.current_session
        ? {
            id: table.current_session.id,
            status: table.current_session.status,
            payment_requested_at: table.current_session.payment_requested_at,
            paid_at: table.current_session.paid_at,
          }
        : null,
    };
  }

  private serializeTableDetail(table: TableDetailRecord) {
    const orders = table.current_session?.orders ?? [];
    return {
      ...this.serializeTable(table),
      songs: table.songs.map((song) => ({
        ...song,
      })),
      queue_items: table.queue_items.map((queueItem) => ({
        ...queueItem,
        priority_score: this.toNumber(queueItem.priority_score),
      })),
      orders: orders.map((order) => ({
        ...order,
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
