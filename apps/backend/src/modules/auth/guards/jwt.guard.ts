import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { TokenService } from "../token.service";
import type { AuthPayload } from "../types";

export const AUTH_KINDS_KEY = "auth:kinds";

/**
 * Generic JWT guard. Validates the Authorization header, verifies the token
 * via TokenService, and attaches `req.auth` with the payload.
 *
 * Usage:
 *   @UseGuards(JwtGuard)
 *   @AuthKinds('admin')           -> only admin/staff tokens accepted
 *   @AuthKinds('session')         -> only session tokens
 *   @AuthKinds('admin', 'session')-> either works (used by endpoints both
 *                                     roles can call)
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException({
        message: "Missing bearer token",
        code: "AUTH_MISSING_TOKEN",
      });
    }
    const token = header.slice("Bearer ".length).trim();
    const payload: AuthPayload = this.tokens.verify(token);

    const allowed = this.reflector.getAllAndOverride<
      AuthPayload["kind"][] | undefined
    >(AUTH_KINDS_KEY, [context.getHandler(), context.getClass()]);

    if (allowed && !allowed.includes(payload.kind)) {
      throw new UnauthorizedException({
        message: `Token kind '${payload.kind}' not allowed here`,
        code: "AUTH_KIND_FORBIDDEN",
      });
    }

    req.auth = payload;
    return true;
  }
}
