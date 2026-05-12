import { Module } from "@nestjs/common";
import { AccessCodeController } from "./access-code.controller";
import { AccessCodeService } from "./access-code.service";
import { AuditLogModule } from "../audit-log/audit-log.module";

@Module({
  imports: [AuditLogModule],
  controllers: [AccessCodeController],
  providers: [AccessCodeService],
  exports: [AccessCodeService],
})
export class AccessCodeModule {}
