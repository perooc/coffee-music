import { Module } from "@nestjs/common";
import { ProductsModule } from "../products/products.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { OrderRequestsController } from "./order-requests.controller";
import { OrderRequestsService } from "./order-requests.service";

@Module({
  imports: [RealtimeModule, ProductsModule],
  controllers: [OrderRequestsController],
  providers: [OrderRequestsService],
  exports: [OrderRequestsService],
})
export class OrderRequestsModule {}
