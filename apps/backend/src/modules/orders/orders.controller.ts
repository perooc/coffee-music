import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { OrderStatus } from "@prisma/client";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { OrdersService } from "./orders.service";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import type { AuthPayload } from "../auth/types";

@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Admin sees everything, optionally filtered.
   * Session client sees only orders of its own session.
   * A session caller without `table_session_id`, or with a mismatching one,
   * is rejected rather than silently defaulted.
   */
  @Get()
  @UseGuards(JwtGuard)
  @AuthKinds("admin", "session")
  async findAll(
    @CurrentAuth() auth: AuthPayload,
    @Query("status") status?: OrderStatus,
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

    const orders = await this.ordersService.findAll({
      status,
      tableSessionId: parsed,
    });
    return orders.map((o) => this.ordersService.serialize(o));
  }

  @Get(":id")
  @UseGuards(JwtGuard)
  @AuthKinds("admin", "session")
  async findOne(
    @Param("id", ParseIntPipe) id: number,
    @CurrentAuth() auth: AuthPayload,
  ) {
    const order = await this.ordersService.findOne(id);
    if (auth.kind === "session" && order.table_session_id !== auth.session_id) {
      throw new ForbiddenException({
        message: "Cross-session access denied",
        code: "AUTH_CROSS_SESSION",
      });
    }
    return this.ordersService.serialize(order);
  }

  @Patch(":id/status")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async updateStatus(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const order = await this.ordersService.updateStatus(id, dto.status);
    return this.ordersService.serialize(order);
  }
}
