import { Module } from "@nestjs/common";
import { SalesInsightsController } from "./sales-insights.controller";
import { SalesInsightsService } from "./sales-insights.service";

@Module({
  controllers: [SalesInsightsController],
  providers: [SalesInsightsService],
  exports: [SalesInsightsService],
})
export class SalesInsightsModule {}
