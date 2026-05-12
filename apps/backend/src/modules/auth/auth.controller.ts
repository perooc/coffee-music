import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { AuthKinds } from "./guards/decorators";
import { JwtGuard } from "./guards/jwt.guard";

function clientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0]?.trim() ?? null;
  if (Array.isArray(fwd)) return fwd[0] ?? null;
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, clientIp(req));
  }

  @Get("me")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async me(@Req() req: Request) {
    if (!req.auth || req.auth.kind !== "admin") {
      throw new Error("unreachable");
    }
    return this.auth.findById(req.auth.sub);
  }

  /**
   * Public. Mints a single-use reset token and emails it. We never tell
   * the caller whether the email exists — same response either way — so
   * the endpoint can't be used to enumerate admins.
   */
  @Post("forgot-password")
  async forgot(@Body() body: { email: string }, @Req() req: Request) {
    return this.auth.requestPasswordReset(body?.email ?? "", clientIp(req));
  }

  /**
   * Public. Consumes the reset token and rotates the password. Token is
   * scoped to the email and burns after use.
   */
  @Post("reset-password")
  async reset(
    @Body() body: { email: string; token: string; password: string },
  ) {
    return this.auth.resetPassword(
      body?.email ?? "",
      body?.token ?? "",
      body?.password ?? "",
    );
  }
}
