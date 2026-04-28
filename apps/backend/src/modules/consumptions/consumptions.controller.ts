import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ConsumptionsService, AuditActor } from "./consumptions.service";
import { CreateAdjustmentDto } from "./dto/create-adjustment.dto";
import { RefundConsumptionDto } from "./dto/refund-consumption.dto";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";
import { SessionAccessGuard } from "../auth/guards/session-access.guard";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import type { AuthPayload } from "../auth/types";

@Controller()
export class ConsumptionsController {
  constructor(private readonly service: ConsumptionsService) {}

  /**
   * Bill view. Admin sees any session; session client sees only its own.
   * SessionAccessGuard pulls `sessionId` from the param and matches it
   * against the token.
   */
  @Get("bill/:sessionId")
  @UseGuards(JwtGuard, SessionAccessGuard)
  @AuthKinds("admin", "session")
  getBill(@Param("sessionId", ParseIntPipe) sessionId: number) {
    return this.service.getBill(sessionId);
  }

  @Post("bill/:sessionId/adjustments")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async createAdjustment(
    @Param("sessionId", ParseIntPipe) sessionId: number,
    @Body() dto: CreateAdjustmentDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    const created = await this.service.createAdjustment(
      sessionId,
      dto,
      toActor(auth),
    );
    return this.service.serialize(created);
  }

  @Post("consumptions/:id/refund")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async refund(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RefundConsumptionDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    const refund = await this.service.refundConsumption(
      id,
      dto,
      toActor(auth),
    );
    return this.service.serialize(refund);
  }
}

/**
 * Narrow the AuthPayload down to the shape the service expects. We only
 * audit admin actors — guards above guarantee we never reach here with a
 * non-admin token.
 */
function toActor(auth: AuthPayload | undefined): AuditActor {
  if (!auth || auth.kind !== "admin") return null;
  return { user_id: auth.sub, name: auth.name };
}
