import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { ConsumptionsController } from "./consumptions.controller";
import { ConsumptionsService } from "./consumptions.service";
import { AuditLogModule } from "../audit-log/audit-log.module";

@Module({
  imports: [RealtimeModule, AuditLogModule],
  controllers: [ConsumptionsController],
  providers: [ConsumptionsService],
  exports: [ConsumptionsService],
})
export class ConsumptionsModule {}
