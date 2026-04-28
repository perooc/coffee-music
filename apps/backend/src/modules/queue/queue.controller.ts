import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CreateQueueItemDto } from "./dto/create-queue-item.dto";
import { AdminQueueItemDto } from "./dto/admin-queue-item.dto";
import { QueueService } from "./queue.service";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import type { AuthPayload } from "../auth/types";

@Controller("queue")
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  /**
   * Public read surface. The in-house TV player consumes these without auth.
   * Exposing only aggregate queue state (titles, durations, table_ids) is
   * acceptable — no customer PII or pricing.
   */
  @Get("global")
  findGlobal() {
    return this.queueService.findGlobal();
  }

  @Get("current")
  getCurrentPlaying() {
    return this.queueService.getCurrentPlaying();
  }

  @Get("stats")
  getStats() {
    return this.queueService.getStats();
  }

  /**
   * Per-table queue view. Customer (session token) can only request its own
   * table; admin can request any.
   */
  @Get()
  @UseGuards(JwtGuard)
  @AuthKinds("admin", "session")
  findByTable(
    @CurrentAuth() auth: AuthPayload,
    @Query("table_id", ParseIntPipe) tableId: number,
    @Query("include_history") includeHistory?: string,
  ) {
    if (auth.kind === "session" && auth.table_id !== tableId) {
      throw new ForbiddenException({
        message: "Cross-table access denied",
        code: "AUTH_CROSS_TABLE",
      });
    }
    return this.queueService.findByTable(tableId, includeHistory === "true");
  }

  /**
   * Customer adds a song. Requires a session token because queueing is part
   * of a live visit, not a bare table. Body's `table_id` must match the
   * session token's `table_id` — the token is the source of truth.
   */
  @Post()
  @UseGuards(JwtGuard)
  @AuthKinds("session")
  create(
    @Body() dto: CreateQueueItemDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    if (auth.kind !== "session") {
      throw new ForbiddenException({
        message: "Session token required",
        code: "AUTH_SESSION_REQUIRED",
      });
    }
    if (dto.table_id !== auth.table_id) {
      throw new ForbiddenException({
        message: "Body table_id does not match session token",
        code: "AUTH_CROSS_TABLE",
      });
    }
    return this.queueService.create({ ...dto, table_id: auth.table_id });
  }

  @Post("play-next")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  playNext() {
    return this.queueService.playNext();
  }

  @Post("finish-current")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  finishCurrent() {
    return this.queueService.finishCurrent();
  }

  @Post("next")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  advanceToNext() {
    return this.queueService.advanceToNext();
  }

  @Post("skip-and-advance")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  skipAndAdvance() {
    return this.queueService.skipAndAdvance();
  }

  @Post("admin")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  adminCreate(@Body() dto: AdminQueueItemDto) {
    return this.queueService.adminCreate(dto);
  }

  @Post("admin/play-now")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  adminPlayNow(@Body() dto: AdminQueueItemDto) {
    return this.queueService.adminPlayNow(dto);
  }

  @Patch(":id/skip")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  skip(@Param("id", ParseIntPipe) id: number) {
    return this.queueService.skip(id);
  }
}
