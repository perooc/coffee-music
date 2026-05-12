import { Module } from "@nestjs/common";
import { AuditLogController } from "./audit-log.controller";
import { AuditLogService } from "./audit-log.service";

@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService],
  // Exported so other modules (auth, table-sessions, products,
  // consumptions, etc.) can inject it and write entries on side-effects.
  exports: [AuditLogService],
})
export class AuditLogModule {}
