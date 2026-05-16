import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  LuggagePaymentStatus,
  LuggageStatus,
  LuggageTicket,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { CreateLuggageDto } from "./dto/create-luggage.dto";
import { IncidentLuggageDto } from "./dto/incident-luggage.dto";
import { UpdateLuggagePaymentDto } from "./dto/update-luggage-payment.dto";

/**
 * Precio fijo de guardarropa, forzado por backend. Misma filosofía que
 * RESTROOM_PRICES: vive en el código, no en BD/config, para que un
 * cambio quede en commit auditable.
 */
const LUGGAGE_PRICE = 5000;

/**
 * Rango de números de ficha física en circulación. Si más adelante se
 * imprimen fichas nuevas, ampliar acá y notar el cambio operativo.
 */
const LUGGAGE_TICKET_MIN = 1;
const LUGGAGE_TICKET_MAX = 30;

export type SerializedLuggageTicket = Omit<LuggageTicket, "amount"> & {
  amount: number;
};

export type Actor = { user_id: number; name: string } | null;

@Injectable()
export class LuggageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crear ticket. La unicidad de ficha activa la enforce el partial
   * unique index `LuggageTicket_ticket_number_active_uniq` a nivel BD:
   * si dos staff intentan registrar la ficha 12 a la vez, Postgres
   * rechaza el segundo con código P2002 (unique violation) y respondemos
   * 409. Sin chequeo previo + race condition: el índice es la verdad.
   */
  async create(
    dto: CreateLuggageDto,
    actor: Actor,
  ): Promise<SerializedLuggageTicket> {
    if (
      dto.ticket_number < LUGGAGE_TICKET_MIN ||
      dto.ticket_number > LUGGAGE_TICKET_MAX
    ) {
      throw new BadRequestException({
        message: `ticket_number must be between ${LUGGAGE_TICKET_MIN} and ${LUGGAGE_TICKET_MAX}`,
        code: "LUGGAGE_INVALID_TICKET_NUMBER",
      });
    }
    try {
      const created = await this.prisma.luggageTicket.create({
        data: {
          ticket_number: dto.ticket_number,
          customer_first_name: dto.customer_first_name.trim(),
          customer_last_name: dto.customer_last_name.trim(),
          customer_phone: dto.customer_phone.trim(),
          amount: new Prisma.Decimal(LUGGAGE_PRICE),
          payment_status:
            dto.payment_status === "paid"
              ? LuggagePaymentStatus.paid
              : LuggagePaymentStatus.pending,
          status: LuggageStatus.active,
          notes: dto.notes?.trim() || null,
          created_by: actor?.name ?? null,
        },
      });
      return this.serialize(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException({
          message: `Ficha ${dto.ticket_number} ya está en uso`,
          code: "LUGGAGE_TICKET_IN_USE",
        });
      }
      throw err;
    }
  }

  async findAll(filter?: {
    status?: LuggageStatus;
    limit?: number;
  }): Promise<SerializedLuggageTicket[]> {
    const where: Prisma.LuggageTicketWhereInput = {};
    if (filter?.status) where.status = filter.status;
    const rows = await this.prisma.luggageTicket.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: filter?.limit && filter.limit > 0 ? filter.limit : undefined,
    });
    return rows.map((r) => this.serialize(r));
  }

  /**
   * Búsqueda libre por nombre/apellido/teléfono/ficha. Devuelve solo
   * tickets activos por default — buscar al cliente que ya retiró no es
   * el use case típico. Si se necesita historial, agregar `include_all`.
   */
  async search(query: string): Promise<SerializedLuggageTicket[]> {
    const q = query.trim();
    if (q.length === 0) return [];

    // Si la query es 100% dígitos, probablemente busca teléfono o ficha.
    const isNumeric = /^\d+$/.test(q);
    const where: Prisma.LuggageTicketWhereInput = {
      status: LuggageStatus.active,
      OR: [
        {
          customer_first_name: { contains: q, mode: "insensitive" },
        },
        {
          customer_last_name: { contains: q, mode: "insensitive" },
        },
        { customer_phone: { contains: q } },
      ],
    };
    if (isNumeric) {
      const asNumber = Number.parseInt(q, 10);
      if (
        Number.isFinite(asNumber) &&
        asNumber >= LUGGAGE_TICKET_MIN &&
        asNumber <= LUGGAGE_TICKET_MAX
      ) {
        where.OR!.push({ ticket_number: asNumber });
      }
    }
    const rows = await this.prisma.luggageTicket.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: 50,
    });
    return rows.map((r) => this.serialize(r));
  }

  /**
   * Entregar: active → delivered. La ficha vuelve a estar disponible
   * (porque el partial unique index solo aplica a status=active). Si
   * la maleta ya no está activa, ConflictException.
   */
  async deliver(
    id: number,
    actor: Actor,
  ): Promise<SerializedLuggageTicket> {
    const ticket = await this.prisma.luggageTicket.findUnique({
      where: { id },
    });
    if (!ticket) {
      throw new NotFoundException(`LuggageTicket ${id} not found`);
    }
    if (ticket.status !== LuggageStatus.active) {
      throw new ConflictException({
        message: `LuggageTicket ${id} is not active (status=${ticket.status})`,
        code: "LUGGAGE_NOT_ACTIVE",
      });
    }
    const result = await this.prisma.luggageTicket.updateMany({
      where: { id, status: LuggageStatus.active },
      data: {
        status: LuggageStatus.delivered,
        delivered_at: new Date(),
        delivered_by: actor?.name ?? null,
      },
    });
    if (result.count === 0) {
      throw new ConflictException({
        message: `LuggageTicket ${id} was modified concurrently`,
        code: "LUGGAGE_RACE",
      });
    }
    const fresh = await this.prisma.luggageTicket.findUniqueOrThrow({
      where: { id },
    });
    return this.serialize(fresh);
  }

  /**
   * Reportar incidente (ficha perdida, etc.). Razón obligatoria. La
   * ficha también vuelve a quedar libre porque el índice parcial deja
   * de aplicarle a esa fila.
   */
  async incident(
    id: number,
    dto: IncidentLuggageDto,
    actor: Actor,
  ): Promise<SerializedLuggageTicket> {
    const ticket = await this.prisma.luggageTicket.findUnique({
      where: { id },
    });
    if (!ticket) {
      throw new NotFoundException(`LuggageTicket ${id} not found`);
    }
    if (ticket.status !== LuggageStatus.active) {
      throw new ConflictException({
        message: `LuggageTicket ${id} is not active (status=${ticket.status})`,
        code: "LUGGAGE_NOT_ACTIVE",
      });
    }
    const result = await this.prisma.luggageTicket.updateMany({
      where: { id, status: LuggageStatus.active },
      data: {
        status: LuggageStatus.incident,
        incident_at: new Date(),
        incident_by: actor?.name ?? null,
        incident_reason: dto.reason.trim(),
      },
    });
    if (result.count === 0) {
      throw new ConflictException({
        message: `LuggageTicket ${id} was modified concurrently`,
        code: "LUGGAGE_RACE",
      });
    }
    const fresh = await this.prisma.luggageTicket.findUniqueOrThrow({
      where: { id },
    });
    return this.serialize(fresh);
  }

  /**
   * Cambiar el estado de pago. Solo válido en tickets active. Una vez
   * entregado o con incidente, el estado de pago queda congelado.
   */
  async updatePayment(
    id: number,
    dto: UpdateLuggagePaymentDto,
  ): Promise<SerializedLuggageTicket> {
    const ticket = await this.prisma.luggageTicket.findUnique({
      where: { id },
    });
    if (!ticket) {
      throw new NotFoundException(`LuggageTicket ${id} not found`);
    }
    if (ticket.status !== LuggageStatus.active) {
      throw new ConflictException({
        message: `LuggageTicket ${id} is not active`,
        code: "LUGGAGE_NOT_ACTIVE",
      });
    }
    const updated = await this.prisma.luggageTicket.update({
      where: { id },
      data: {
        payment_status:
          dto.payment_status === "paid"
            ? LuggagePaymentStatus.paid
            : LuggagePaymentStatus.pending,
      },
    });
    return this.serialize(updated);
  }

  /**
   * Resumen de ingresos por guardarropa en un rango. Cuenta tickets que
   * estén marcados como `paid` con `created_at` dentro del rango,
   * cualquiera sea su status actual (active/delivered/incident) — la
   * plata se cobró cuando se registró el ticket, no cuando se entregó.
   */
  async getSummary(opts: {
    from?: Date;
    to?: Date;
  }): Promise<{
    range: { from: string; to: string };
    luggage: {
      count: number;
      revenue: number;
      pending_count: number;
      active_count: number;
      incident_count: number;
    };
  }> {
    const { from, to } = this.resolveDefaultRange(opts.from, opts.to);
    const rows = await this.prisma.luggageTicket.findMany({
      where: { created_at: { gte: from, lt: to } },
      select: {
        amount: true,
        payment_status: true,
        status: true,
      },
    });
    let paidCount = 0;
    let revenue = 0;
    let pendingCount = 0;
    let activeCount = 0;
    let incidentCount = 0;
    for (const r of rows) {
      if (r.payment_status === LuggagePaymentStatus.paid) {
        paidCount += 1;
        revenue += Number(r.amount);
      } else {
        pendingCount += 1;
      }
      if (r.status === LuggageStatus.active) activeCount += 1;
      else if (r.status === LuggageStatus.incident) incidentCount += 1;
    }
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      luggage: {
        count: paidCount,
        revenue: round(revenue),
        pending_count: pendingCount,
        active_count: activeCount,
        incident_count: incidentCount,
      },
    };
  }

  private resolveDefaultRange(
    from: Date | undefined,
    to: Date | undefined,
  ): { from: Date; to: Date } {
    if (from && to) return { from, to };
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    return { from: from ?? today, to: to ?? tomorrow };
  }

  serialize(row: LuggageTicket): SerializedLuggageTicket {
    return { ...row, amount: Number(row.amount) };
  }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
