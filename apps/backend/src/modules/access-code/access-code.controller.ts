import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AccessCodeService } from "./access-code.service";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import type { AuthPayload } from "../auth/types";
import { AuditLogService } from "../audit-log/audit-log.service";

/**
 * Two surfaces:
 *   - Public POST /access-code/validate — used by the customer device
 *     gate before opening a session. Rate-limited via the global
 *     middleware to slow down brute-force attempts.
 *   - Admin GET / POST rotate — used by the dashboard widget so staff
 *     can see the current code and refresh it on demand.
 */
@Controller("access-code")
export class AccessCodeController {
  constructor(
    private readonly service: AccessCodeService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Public. Returns whether the supplied 4-digit code matches today's
   * active one. We never echo the active code on this endpoint — only
   * yes/no. Brute force is bounded by the rate limit.
   */
  @Post("validate")
  async validate(@Body() body: { code: string }) {
    const ok = await this.service.validate(body?.code ?? "");
    if (!ok) {
      throw new BadRequestException({
        message: "Código incorrecto",
        code: "BAR_CODE_INVALID",
      });
    }
    return { ok: true };
  }

  /**
   * Admin: see the current code. Lazily generates one if there's no
   * active row, so the dashboard always has something to show.
   */
  @Get("current")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async current() {
    return this.service.getOrRotate();
  }

  /**
   * Public-display surface for the bar's TV/player screen. Returns the
   * same payload as `/current` but without auth. Safe because the code
   * is meant to be visible on a screen anyone in the bar can see — the
   * security model never relied on it being secret online, only on the
   * customer being physically present to read it.
   */
  @Get("display")
  async display() {
    return this.service.getOrRotate();
  }

  /**
   * Admin: force a rotation. Returns the freshly minted code.
   */
  @Post("rotate")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async rotate(@CurrentAuth() auth: AuthPayload) {
    const actor =
      auth.kind === "admin" ? `admin#${auth.sub}` : auth.kind;
    const result = await this.service.rotate(actor);
    if (auth.kind === "admin") {
      void this.audit.record({
        kind: "access_code_rotated",
        actor_id: auth.sub,
        actor_label: auth.name,
        new_code: result.code,
      });
    }
    return result;
  }
}
