import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { TableSessionsController } from "./table-sessions.controller";
import { TableSessionsService } from "./table-sessions.service";
import { AuditLogModule } from "../audit-log/audit-log.module";

@Module({
  imports: [RealtimeModule, AuditLogModule],
  controllers: [TableSessionsController],
  providers: [TableSessionsService],
  exports: [TableSessionsService],
})
export class TableSessionsModule {}
