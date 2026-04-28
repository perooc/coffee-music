import { SetMetadata } from "@nestjs/common";
import type { UserRole } from "@prisma/client";
import { AUTH_KINDS_KEY } from "./jwt.guard";
import { ROLES_KEY } from "./roles.guard";
import type { AuthPayload } from "../types";

/**
 * Restrict this route to tokens of the given kinds.
 *
 *   @AuthKinds('admin')            staff/admin only
 *   @AuthKinds('session')          customer in an active session
 *   @AuthKinds('table', 'session') customer on the QR, with or without session
 */
export const AuthKinds = (...kinds: AuthPayload["kind"][]) =>
  SetMetadata(AUTH_KINDS_KEY, kinds);

/**
 * Restrict this route to specific user roles. Only applies to `admin` kind
 * tokens (table/session tokens do not carry a role).
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
