import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TablesService } from "./tables.service";
import { TableSessionsService } from "../table-sessions/table-sessions.service";
import { UpdateTableDto } from "./dto/update-table.dto";
import { CreateBarDto } from "./dto/create-bar.dto";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import type { AuthPayload } from "../auth/types";
import { AuditLogService } from "../audit-log/audit-log.service";

/**
 * Tables surface = staff only. Customers do not need to list tables; they
 * arrive at /mesa/:id via the QR and read their own table/session there.
 * Every endpoint requires an admin token.
 */
@Controller("tables")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class TablesController {
  constructor(
    private readonly tablesService: TablesService,
    private readonly sessions: TableSessionsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  findAll() {
    return this.tablesService.findAll();
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.tablesService.findOne(id);
  }

  @Get(":id/detail")
  findOneDetailed(@Param("id", ParseIntPipe) id: number) {
    return this.tablesService.findOneDetailed(id);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id", ParseIntPipe) id: number,
    @Body() updateTableDto: UpdateTableDto,
  ) {
    return this.tablesService.updateStatus(id, updateTableDto);
  }

  @Post("bars")
  createBar(@Body() dto: CreateBarDto) {
    return this.tablesService.createBar(dto.name);
  }

  @Delete("bars/:id")
  deleteBar(@Param("id", ParseIntPipe) id: number) {
    return this.tablesService.deleteBar(id);
  }

  /**
   * One-shot "open a walk-in account": create the virtual BAR row AND
   * open its session in the same call. The frontend used to do these
   * two steps separately, but staff thinks of it as a single action
   * ("¿Abrir cuenta para Camilo?") so we expose it that way.
   *
   * If session-open fails, we roll back the bar create — otherwise
   * we'd leak orphan BAR rows the staff couldn't easily clean up.
   */
  @Post("bars/walkin")
  async openWalkInAccount(
    @Body() dto: CreateBarDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    const bar = await this.tablesService.createBar(dto.name);
    try {
      const session = await this.sessions.open(bar.id, {
        customName: dto.name,
        openedBy: "staff",
      });
      if (auth && auth.kind === "admin") {
        void this.audit.record({
          kind: "walkin_account_opened",
          actor_id: auth.sub,
          actor_label: auth.name,
          session_id: session.id,
          table_id: bar.id,
          custom_name: dto.name,
        });
      }
      return {
        table: bar,
        session: this.sessions.serialize(session),
      };
    } catch (err) {
      // Roll back the bar so the grid doesn't show an orphan.
      await this.tablesService.deleteBar(bar.id).catch(() => {
        /* swallow — surfacing the original error is more useful */
      });
      throw err;
    }
  }
}
