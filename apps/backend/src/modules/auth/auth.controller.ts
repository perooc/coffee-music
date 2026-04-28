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

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  async login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get("me")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async me(@Req() req: Request) {
    if (!req.auth || req.auth.kind !== "admin") {
      // Guard already enforces this, but the type narrow helps the service call.
      throw new Error("unreachable");
    }
    return this.auth.findById(req.auth.sub);
  }
}
