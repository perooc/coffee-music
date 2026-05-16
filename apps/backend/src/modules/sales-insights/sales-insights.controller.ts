import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthKinds } from "../auth/guards/decorators";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { SalesInsightsService } from "./sales-insights.service";

/**
 * Aggregated sales view for the admin. Backed by Consumption (the ledger),
 * never by OrderItem directly — see service comment.
 */
@Controller("admin/sales")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class SalesInsightsController {
  constructor(private readonly service: SalesInsightsService) {}

  @Get("insights")
  insights(
    @Query("day") day?: string,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("top_limit") topLimit?: string,
  ) {
    return this.service.getInsights({
      day: day?.trim() || undefined,
      days: days ? parseIntStrict(days, "days") : undefined,
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
      topLimit: topLimit ? parseIntStrict(topLimit, "top_limit") : undefined,
    });
  }

  /**
   * Histórico de ventas día-por-día de un producto.
   * Default: últimos 60 días. Acepta `from`/`to` para rango personalizado.
   */
  @Get("products/:id/history")
  productHistory(
    @Param("id", ParseIntPipe) id: number,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.service.getProductHistory({
      productId: id,
      days: days ? parseIntStrict(days, "days") : undefined,
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
    });
  }

  /**
   * Cuentas cerradas (paid + void) en el rango con detalle de líneas.
   * Es la fuente del tab "Detalle" en /admin/sales.
   */
  @Get("sessions")
  closedSessions(
    @Query("day") day?: string,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.service.getClosedSessions({
      day: day?.trim() || undefined,
      days: days ? parseIntStrict(days, "days") : undefined,
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
    });
  }

  /**
   * Catálogo completo con métricas en el rango. Es la fuente del tab
   * "Productos" en /admin/sales. Acepta buscador, orden y paginado.
   */
  @Get("products")
  allProducts(
    @Query("day") day?: string,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("search") search?: string,
    @Query("sort") sort?: string,
    @Query("direction") direction?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("include_inactive") includeInactive?: string,
  ) {
    return this.service.getAllProductsMetrics({
      day: day?.trim() || undefined,
      days: days ? parseIntStrict(days, "days") : undefined,
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
      search: search?.trim() || undefined,
      sort: parseSort(sort),
      direction: parseDirection(direction),
      page: page ? parseIntStrict(page, "page") : undefined,
      page_size: pageSize ? parseIntStrict(pageSize, "page_size") : undefined,
      include_inactive: includeInactive === "true",
    });
  }
}

function parseSort(
  value: string | undefined,
): "revenue" | "units" | "name" | "category" | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "revenue" || v === "units" || v === "name" || v === "category") {
    return v;
  }
  throw new BadRequestException({
    message: `Invalid sort: ${value}`,
    code: "SALES_INVALID_PARAM",
  });
}

function parseDirection(
  value: string | undefined,
): "asc" | "desc" | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "asc" || v === "desc") return v;
  throw new BadRequestException({
    message: `Invalid direction: ${value}`,
    code: "SALES_INVALID_PARAM",
  });
}

function parseIntStrict(value: string, field: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new BadRequestException({
      message: `Invalid \`${field}\` — must be an integer`,
      code: "SALES_INVALID_PARAM",
    });
  }
  return n;
}
