import { Module } from "@nestjs/common";
import { ConsumptionsModule } from "../consumptions/consumptions.module";
import { ProductsModule } from "../products/products.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [ConsumptionsModule, RealtimeModule, ProductsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
