import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { OrderRequestStatus } from "@prisma/client";
import { OrderRequestsService } from "./order-requests.service";
import { CreateOrderRequestDto } from "./dto/create-order-request.dto";
import { RejectOrderRequestDto } from "./dto/reject-order-request.dto";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import type { AuthPayload } from "../auth/types";

@Controller("order-requests")
export class OrderRequestsController {
  constructor(private readonly service: OrderRequestsService) {}

  /**
   * Admin: unrestricted listing (used by the pending-requests column).
   * Session client: must supply `table_session_id` matching its token.
   */
  @Get()
  @UseGuards(JwtGuard)
  @AuthKinds("admin", "session")
  findAll(
    @CurrentAuth() auth: AuthPayload,
    @Query("status") status?: OrderRequestStatus,
    @Query("table_session_id") tableSessionId?: string,
  ) {
    const parsed = tableSessionId
      ? Number.parseInt(tableSessionId, 10)
      : undefined;
    if (auth.kind === "session") {
      if (parsed == null || parsed !== auth.session_id) {
        throw new ForbiddenException({
          message: "Cross-session access denied",
          code: "AUTH_CROSS_SESSION",
        });
      }
    }
    return this.service.findAll({ status, tableSessionId: parsed });
  }

  @Get(":id")
  @UseGuards(JwtGuard)
  @AuthKinds("admin", "session")
  async findOne(
    @Param("id", ParseIntPipe) id: number,
    @CurrentAuth() auth: AuthPayload,
  ) {
    const request = await this.service.findOne(id);
    if (
      auth.kind === "session" &&
      request.table_session_id !== auth.session_id
    ) {
      throw new ForbiddenException({
        message: "Cross-session access denied",
        code: "AUTH_CROSS_SESSION",
      });
    }
    return request;
  }

  /**
   * Customer creates a request within its active session.
   * The DTO body still carries `table_session_id` for API clarity, but we
   * ignore any value that does not match the session token — the token is
   * the source of truth.
   */
  @Post()
  @UseGuards(JwtGuard)
  @AuthKinds("session")
  async create(
    @Body() dto: CreateOrderRequestDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    if (auth.kind !== "session") {
      throw new ForbiddenException({
        message: "Session token required",
        code: "AUTH_SESSION_REQUIRED",
      });
    }
    if (dto.table_session_id !== auth.session_id) {
      throw new ForbiddenException({
        message: "Body table_session_id does not match session token",
        code: "AUTH_CROSS_SESSION",
      });
    }
    const request = await this.service.create({
      table_session_id: auth.session_id,
      items: dto.items,
    });
    return this.service.serialize(request);
  }

  @Post(":id/accept")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async accept(@Param("id", ParseIntPipe) id: number) {
    const request = await this.service.accept(id);
    return this.service.serialize(request);
  }

  @Post(":id/reject")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async reject(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RejectOrderRequestDto,
  ) {
    const request = await this.service.reject(id, dto.reason);
    return this.service.serialize(request);
  }

  /**
   * Customer cancels its own pending request. Must match session.
   * Admin can also cancel (e.g. to clean up stuck rows) — useful in edge cases.
   */
  @Post(":id/cancel")
  @UseGuards(JwtGuard)
  @AuthKinds("admin", "session")
  async cancel(
    @Param("id", ParseIntPipe) id: number,
    @CurrentAuth() auth: AuthPayload,
  ) {
    if (auth.kind === "session") {
      const existing = await this.service.findOne(id);
      if (existing.table_session_id !== auth.session_id) {
        throw new ForbiddenException({
          message: "Cross-session access denied",
          code: "AUTH_CROSS_SESSION",
        });
      }
    }
    const request = await this.service.cancelByCustomer(id);
    return this.service.serialize(request);
  }
}
