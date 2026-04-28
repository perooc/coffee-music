import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { UserRole } from "@prisma/client";

export const ROLES_KEY = "auth:roles";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.auth;
    if (!auth || auth.kind !== "admin") {
      throw new ForbiddenException({
        message: "Admin token required",
        code: "AUTH_ADMIN_REQUIRED",
      });
    }
    if (!required.includes(auth.role)) {
      throw new ForbiddenException({
        message: `Role '${auth.role}' not allowed`,
        code: "AUTH_ROLE_FORBIDDEN",
      });
    }
    return true;
  }
}
