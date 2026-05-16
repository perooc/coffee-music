import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { LuggageStatus } from "@prisma/client";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import { AuthKinds } from "../auth/guards/decorators";
import { JwtGuard } from "../auth/guards/jwt.guard";
import type { AuthPayload } from "../auth/types";
import { CreateLuggageDto } from "./dto/create-luggage.dto";
import { IncidentLuggageDto } from "./dto/incident-luggage.dto";
import { UpdateLuggagePaymentDto } from "./dto/update-luggage-payment.dto";
import { LuggageService, type Actor } from "./luggage.service";

/**
 * Endpoints de guardarropa:
 *
 *   POST   /admin/luggage                  registrar maleta nueva
 *   GET    /admin/luggage                  listar (?status=active|delivered|incident)
 *   GET    /admin/luggage/search           buscar (?q=teléfono|nombre|ficha)
 *   GET    /admin/luggage/summary          resumen del día/rango
 *   POST   /admin/luggage/:id/deliver      entregar
 *   POST   /admin/luggage/:id/incident     reportar incidente
 *   PATCH  /admin/luggage/:id/payment      marcar como paid/pending
 */
@Controller("admin/luggage")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class LuggageController {
  constructor(private readonly service: LuggageService) {}

  @Post()
  create(@Body() dto: CreateLuggageDto, @CurrentAuth() auth: AuthPayload) {
    return this.service.create(dto, toActor(auth));
  }

  @Get()
  findAll(@Query("status") status?: string, @Query("limit") limit?: string) {
    return this.service.findAll({
      status: parseStatus(status),
      limit: limit ? parseIntStrict(limit, "limit") : undefined,
    });
  }

  @Get("search")
  search(@Query("q") q?: string) {
    return this.service.search(q ?? "");
  }

  @Get("summary")
  summary(@Query("from") from?: string, @Query("to") to?: string) {
    return this.service.getSummary({
      from: parseDate(from, "from"),
      to: parseDate(to, "to"),
    });
  }

  @Post(":id/deliver")
  deliver(
    @Param("id", ParseIntPipe) id: number,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.deliver(id, toActor(auth));
  }

  @Post(":id/incident")
  incident(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: IncidentLuggageDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.incident(id, dto, toActor(auth));
  }

  @Patch(":id/payment")
  updatePayment(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateLuggagePaymentDto,
  ) {
    return this.service.updatePayment(id, dto);
  }
}

function toActor(auth: AuthPayload | undefined): Actor {
  if (!auth || auth.kind !== "admin") return null;
  return { user_id: auth.sub, name: auth.name };
}

function parseStatus(value: string | undefined): LuggageStatus | undefined {
  if (!value) return undefined;
  if (value === "active") return LuggageStatus.active;
  if (value === "delivered") return LuggageStatus.delivered;
  if (value === "incident") return LuggageStatus.incident;
  throw new BadRequestException({
    message: `Invalid status: ${value}`,
    code: "LUGGAGE_INVALID_STATUS",
  });
}

function parseDate(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException({
      message: `Invalid date in \`${field}\``,
      code: "LUGGAGE_INVALID_DATE",
    });
  }
  return d;
}

function parseIntStrict(value: string, field: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException({
      message: `Invalid \`${field}\``,
      code: "LUGGAGE_INVALID_PARAM",
    });
  }
  return n;
}
