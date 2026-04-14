import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./modules/health/health.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { ProductsModule } from "./modules/products/products.module";
import { QueueModule } from "./modules/queue/queue.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { TablesModule } from "./modules/tables/tables.module";
import { MusicModule } from "./modules/music/music.module";
import { rateLimitMiddleware } from "./common/rate-limit.middleware";
import { loggingMiddleware } from "./common/logging.middleware";
import { PlaybackModule } from "./modules/playback/playback.module";

@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    MusicModule,
    OrdersModule,
    ProductsModule,
    QueueModule,
    RealtimeModule,
    PlaybackModule,
    TablesModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(loggingMiddleware)
      .forRoutes({ path: "*", method: RequestMethod.ALL });

    consumer
      .apply(rateLimitMiddleware)
      .forRoutes(
        { path: "queue", method: RequestMethod.ALL },
        { path: "orders", method: RequestMethod.ALL },
        { path: "music/search", method: RequestMethod.ALL },
      );
  }
}
