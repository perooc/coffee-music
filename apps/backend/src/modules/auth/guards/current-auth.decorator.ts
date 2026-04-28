import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { AuthPayload } from "../types";

/**
 * `@CurrentAuth()` injects the verified JWT payload into a controller
 * handler. Only meaningful on routes guarded by JwtGuard — otherwise
 * returns undefined.
 */
export const CurrentAuth = createParamDecorator<AuthPayload | undefined>(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.auth;
  },
);
