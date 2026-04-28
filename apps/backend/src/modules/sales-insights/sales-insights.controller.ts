import { Controller, Get, Query, UseGuards } from "@nestjs/common";
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
    @Query("top_limit") topLimit?: string,
  ) {
    return this.service.getInsights({
      day: day?.trim() || undefined,
      days: days ? Number.parseInt(days, 10) : undefined,
      topLimit: topLimit ? Number.parseInt(topLimit, 10) : undefined,
    });
  }
}
