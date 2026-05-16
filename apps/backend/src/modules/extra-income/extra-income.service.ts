import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ExtraIncome,
  ExtraIncomeStatus,
  ExtraIncomeType,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { CreateRestroomIncomeDto } from "./dto/create-restroom-income.dto";
import { ReverseExtraIncomeDto } from "./dto/reverse-extra-income.dto";

/**
 * Precios de baño FORZADOS por el backend. Vivos acá (no en BD ni
 * config) para que cualquier cambio sea explícito en un commit
 * auditable y no se pueda alterar desde una consola SQL sin que quede
 * en el repo. Si en el futuro hay precios por horario o evento, se
 * mueve a tabla con timestamp de vigencia.
 */
const RESTROOM_PRICES = {
  male: 1000,
  female: 2000,
} as const satisfies Record<"male" | "female", number>;

export type SerializedExtraIncome = Omit<
  ExtraIncome,
  "amount" | "total_amount"
> & {
  amount: number;
  total_amount: number;
};

export type Actor = { user_id: number; name: string } | null;

@Injectable()
export class ExtraIncomeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registrar cobro de baño. El precio se decide acá según el subtype;
   * el body solo lleva el subtype y notas opcionales. Una sola llamada =
   * una unidad — si dos personas usaron el baño se hace dos veces.
   * Permite trazabilidad fina vs. agrupar en `quantity`.
   */
  async createRestroom(
    dto: CreateRestroomIncomeDto,
    actor: Actor,
  ): Promise<SerializedExtraIncome> {
    const amount = RESTROOM_PRICES[dto.subtype];
    const created = await this.prisma.extraIncome.create({
      data: {
        type: ExtraIncomeType.restroom,
        subtype: dto.subtype,
        amount: new Prisma.Decimal(amount),
        quantity: 1,
        total_amount: new Prisma.Decimal(amount),
        status: ExtraIncomeStatus.active,
        notes: dto.notes?.trim() || null,
        created_by: actor?.name ?? null,
      },
    });
    return this.serialize(created);
  }

  async findAll(filter?: {
    type?: ExtraIncomeType;
    status?: ExtraIncomeStatus;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<SerializedExtraIncome[]> {
    const where: Prisma.ExtraIncomeWhereInput = {};
    if (filter?.type) where.type = filter.type;
    if (filter?.status) where.status = filter.status;
    if (filter?.from || filter?.to) {
      where.created_at = {};
      if (filter.from) where.created_at.gte = filter.from;
      if (filter.to) where.created_at.lt = filter.to;
    }
    const rows = await this.prisma.extraIncome.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: filter?.limit && filter.limit > 0 ? filter.limit : undefined,
    });
    return rows.map((r) => this.serialize(r));
  }

  /**
   * Reverso. Es la única forma de "deshacer" un cobro. No se borra:
   *   - El registro original queda intacto (auditoría).
   *   - status pasa a `reversed`.
   *   - Reportes excluyen status=reversed.
   *
   * Idempotencia: si ya está reversed, error 409. No re-reversamos.
   */
  async reverse(
    id: number,
    dto: ReverseExtraIncomeDto,
    actor: Actor,
  ): Promise<SerializedExtraIncome> {
    const original = await this.prisma.extraIncome.findUnique({
      where: { id },
    });
    if (!original) {
      throw new NotFoundException(`ExtraIncome ${id} not found`);
    }
    if (original.status === ExtraIncomeStatus.reversed) {
      throw new ConflictException({
        message: `ExtraIncome ${id} is already reversed`,
        code: "EXTRA_INCOME_ALREADY_REVERSED",
      });
    }
    // updateMany con guarda en `status` para evitar race conditions:
    // dos staff intentando reversar el mismo registro al mismo tiempo
    // solo deja pasar uno. El segundo recibe el ConflictException.
    const result = await this.prisma.extraIncome.updateMany({
      where: { id, status: ExtraIncomeStatus.active },
      data: {
        status: ExtraIncomeStatus.reversed,
        reversed_at: new Date(),
        reversed_by: actor?.name ?? null,
        reverse_reason: dto.reason.trim(),
      },
    });
    if (result.count === 0) {
      throw new ConflictException({
        message: `ExtraIncome ${id} was modified concurrently`,
        code: "EXTRA_INCOME_RACE",
      });
    }
    const updated = await this.prisma.extraIncome.findUniqueOrThrow({
      where: { id },
    });
    return this.serialize(updated);
  }

  /**
   * Resumen del día (o rango si se pasan from/to). Solo cuenta filas
   * `active`. Útil para el card "Baños hoy" del admin sin pedirle al
   * cliente que agregue en memoria.
   */
  async getSummary(opts: {
    from?: Date;
    to?: Date;
  }): Promise<{
    range: { from: string; to: string };
    restroom: {
      male: { count: number; revenue: number };
      female: { count: number; revenue: number };
      total: { count: number; revenue: number };
    };
  }> {
    const { from, to } = this.resolveDefaultRange(opts.from, opts.to);
    const rows = await this.prisma.extraIncome.findMany({
      where: {
        type: ExtraIncomeType.restroom,
        status: ExtraIncomeStatus.active,
        created_at: { gte: from, lt: to },
      },
      select: { subtype: true, quantity: true, total_amount: true },
    });
    let maleCount = 0;
    let maleRevenue = 0;
    let femaleCount = 0;
    let femaleRevenue = 0;
    for (const r of rows) {
      const amount = Number(r.total_amount);
      if (r.subtype === "male") {
        maleCount += r.quantity;
        maleRevenue += amount;
      } else if (r.subtype === "female") {
        femaleCount += r.quantity;
        femaleRevenue += amount;
      }
    }
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      restroom: {
        male: { count: maleCount, revenue: round(maleRevenue) },
        female: { count: femaleCount, revenue: round(femaleRevenue) },
        total: {
          count: maleCount + femaleCount,
          revenue: round(maleRevenue + femaleRevenue),
        },
      },
    };
  }

  /**
   * Default: día de hoy en hora local del server. Si `to` no viene, se
   * empuja al amanecer del día siguiente para incluir todo el día actual.
   */
  private resolveDefaultRange(
    from: Date | undefined,
    to: Date | undefined,
  ): { from: Date; to: Date } {
    if (from && to) return { from, to };
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    return { from: from ?? today, to: to ?? tomorrow };
  }

  serialize(row: ExtraIncome): SerializedExtraIncome {
    return {
      ...row,
      amount: Number(row.amount),
      total_amount: Number(row.total_amount),
    };
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
