import { Module } from "@nestjs/common";
import { TableSessionsModule } from "../table-sessions/table-sessions.module";
import { TablesController } from "./tables.controller";
import { TablesService } from "./tables.service";
import { AuditLogModule } from "../audit-log/audit-log.module";

@Module({
  imports: [TableSessionsModule, AuditLogModule],
  controllers: [TablesController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
