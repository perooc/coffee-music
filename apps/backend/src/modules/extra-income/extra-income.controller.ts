import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ExtraIncomeStatus, ExtraIncomeType } from "@prisma/client";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import { AuthKinds } from "../auth/guards/decorators";
import { JwtGuard } from "../auth/guards/jwt.guard";
import type { AuthPayload } from "../auth/types";
import { CreateRestroomIncomeDto } from "./dto/create-restroom-income.dto";
import { ReverseExtraIncomeDto } from "./dto/reverse-extra-income.dto";
import { ExtraIncomeService, type Actor } from "./extra-income.service";

/**
 * Ingresos no operacionales (baño, etc.) — registrados por staff/admin
 * fuera del flujo de productos/mesas. Endpoints:
 *
 *   POST   /admin/extra-income/restroom       crear cobro de baño
 *   GET    /admin/extra-income                listar
 *   GET    /admin/extra-income/summary        resumen del día/rango
 *   POST   /admin/extra-income/:id/reverse    reversar (con razón)
 *
 * NO hay PATCH ni DELETE: la mutación es siempre create + reverse para
 * preservar trazabilidad. Si en el futuro hay edits de notas, se hace
 * con un endpoint dedicado y se audita.
 */
@Controller("admin/extra-income")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class ExtraIncomeController {
  constructor(private readonly service: ExtraIncomeService) {}

  @Post("restroom")
  createRestroom(
    @Body() dto: CreateRestroomIncomeDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.createRestroom(dto, toActor(auth));
  }

  @Get()
  findAll(
    @Query("type") type?: string,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    return this.service.findAll({
      type: parseType(type),
      status: parseStatus(status),
      from: parseDate(from, "from"),
      to: parseDate(to, "to"),
      limit: limit ? parseIntStrict(limit, "limit") : undefined,
    });
  }

  @Get("summary")
  summary(@Query("from") from?: string, @Query("to") to?: string) {
    return this.service.getSummary({
      from: parseDate(from, "from"),
      to: parseDate(to, "to"),
    });
  }

  @Post(":id/reverse")
  reverse(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReverseExtraIncomeDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.reverse(id, dto, toActor(auth));
  }
}

function toActor(auth: AuthPayload | undefined): Actor {
  if (!auth || auth.kind !== "admin") return null;
  return { user_id: auth.sub, name: auth.name };
}

function parseType(value: string | undefined): ExtraIncomeType | undefined {
  if (!value) return undefined;
  if (value === "restroom") return ExtraIncomeType.restroom;
  throw new BadRequestException({
    message: `Invalid type: ${value}`,
    code: "EXTRA_INCOME_INVALID_TYPE",
  });
}

function parseStatus(value: string | undefined): ExtraIncomeStatus | undefined {
  if (!value) return undefined;
  if (value === "active") return ExtraIncomeStatus.active;
  if (value === "reversed") return ExtraIncomeStatus.reversed;
  throw new BadRequestException({
    message: `Invalid status: ${value}`,
    code: "EXTRA_INCOME_INVALID_STATUS",
  });
}

function parseDate(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException({
      message: `Invalid date in \`${field}\``,
      code: "EXTRA_INCOME_INVALID_DATE",
    });
  }
  return d;
}

function parseIntStrict(value: string, field: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException({
      message: `Invalid \`${field}\``,
      code: "EXTRA_INCOME_INVALID_PARAM",
    });
  }
  return n;
}
