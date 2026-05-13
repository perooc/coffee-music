import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Table, TableKind } from "@prisma/client";
import { randomBytes } from "node:crypto";
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
      // Surface the staff-set label so the admin grid can show it on
      // bar cells ("Cuenta de Camilo" instead of "Cuenta 47").
      custom_name: true,
      opened_by: true,
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
    // Antes corríamos `pruneClosedBars()` acá para limpiar barras
    // virtuales cerradas. Lo SACAMOS porque la cascade Table → Session
    // → Consumption borra las consumiciones del histórico de ventas,
    // y eso hace que los ingresos del día desaparezcan al refrescar
    // la grilla. Las barras cerradas se quedan en la base; el frontend
    // filtra cuáles mostrar según si tienen sesión activa.
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

  /**
   * Create a virtual BAR account. The qr_code column is @unique and
   * NOT NULL, so we generate a placeholder string for it — bars never
   * surface a QR. The `number` we assign is the next free integer
   * across both kinds; staff identify bars by `custom_name` on the
   * session, not by number, so the value is mostly cosmetic.
   */
  async createBar(name: string) {
    const trimmed = (name ?? "").trim();
    if (!trimmed) {
      throw new BadRequestException({
        message: "El nombre de la barra es requerido",
        code: "BAR_NAME_REQUIRED",
      });
    }
    if (trimmed.length > 80) {
      throw new BadRequestException({
        message: "El nombre es demasiado largo (máx 80)",
        code: "BAR_NAME_TOO_LONG",
      });
    }

    // We could pre-allocate a "BAR-N" number range to keep them apart
    // visually from physical tables, but front-end groups by `kind` so
    // there's no collision risk in the UI. Simpler: take the next free.
    const last = await this.prisma.table.findFirst({
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const nextNumber = (last?.number ?? 0) + 1;

    const created = await this.prisma.table.create({
      data: {
        number: nextNumber,
        // Random placeholder to satisfy @unique. Never used for routing.
        qr_code: `bar-${randomBytes(8).toString("hex")}`,
        kind: TableKind.BAR,
        // Bars start "available" same as tables. Status flips to
        // occupied when a session opens; stays in sync via projection.
      },
      include: tableListInclude,
    });

    return this.serializeTableList(created);
  }

  /**
   * Delete a BAR. Refused for TABLE rows — physical tables stay around
   * because their QR is printed on the surface. A BAR with an active
   * session is also refused; the staff must close the session first
   * (loud failure beats silent data loss).
   */
  async deleteBar(id: number) {
    const table = await this.prisma.table.findUnique({
      where: { id },
      select: { id: true, kind: true, current_session_id: true },
    });
    if (!table) {
      throw new NotFoundException(`Table ${id} not found`);
    }
    if (table.kind !== TableKind.BAR) {
      throw new BadRequestException({
        message: "Solo se pueden eliminar barras virtuales",
        code: "TABLE_NOT_DELETABLE",
      });
    }
    if (table.current_session_id !== null) {
      throw new BadRequestException({
        message: "Cierra la cuenta antes de eliminar la barra",
        code: "BAR_HAS_OPEN_SESSION",
      });
    }
    await this.prisma.table.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * ⚠️ NO LLAMAR. Función dejada acá como referencia histórica.
   *
   * Antes corría automáticamente desde findAll() para "limpiar" las
   * barras virtuales cerradas. El problema: la cascade
   *   Table → TableSession → Consumption (onDelete: Cascade)
   * borraba las consumiciones del histórico de ventas, y los ingresos
   * del día desaparecían al refrescar.
   *
   * Si se necesita una limpieza manual de barras viejas, hacerlo con
   * un script ad-hoc que primero migre las consumiciones a una mesa
   * "ARCHIVO" o similar, y solo entonces borre la fila de Table.
   *
   * Mantener el método (vs borrarlo) deja un cartel visible en el
   * código para futuros operadores: "no implementes esto sin leer el
   * comentario de arriba".
   */
  async pruneClosedBars(): Promise<number> {
    throw new Error(
      "pruneClosedBars is disabled: cascading delete would destroy Consumption rows. See method comment.",
    );
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
            custom_name: table.current_session.custom_name,
            opened_by: table.current_session.opened_by,
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
