import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./modules/health/health.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { ProductsModule } from "./modules/products/products.module";
import { QueueModule } from "./modules/queue/queue.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { TablesModule } from "./modules/tables/tables.module";

@Module({
  imports: [DatabaseModule, HealthModule, OrdersModule, ProductsModule, QueueModule, RealtimeModule, TablesModule],
})
export class AppModule {}
