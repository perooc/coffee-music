import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService, JwtSignOptions } from "@nestjs/jwt";
import type {
  AdminTokenPayload,
  AuthPayload,
  SessionTokenPayload,
  TableTokenPayload,
} from "./types";

/**
 * Thin wrapper around @nestjs/jwt that owns the three token kinds.
 *
 * Why a wrapper: we always want `kind` enforced as a claim, not a convention.
 * Callers never touch JwtService directly. If tomorrow we rotate algorithms
 * or split secrets per kind, this file changes alone.
 *
 * Why the `any` on the options object: jsonwebtoken's `expiresIn` type is a
 * literal-string union (e.g. "12h" | number). Reading the value from an env
 * variable produces a generic `string` that won't match, even when the value
 * is valid at runtime. A targeted cast here keeps call sites clean.
 */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  private sign(payload: object, expiresIn: string): string {
    const options = { expiresIn } as unknown as JwtSignOptions;
    return this.jwt.sign(payload as Record<string, unknown>, options);
  }

  signAdmin(payload: Omit<AdminTokenPayload, "kind">): string {
    const claims: AdminTokenPayload = { ...payload, kind: "admin" };
    return this.sign(claims, process.env.JWT_ADMIN_EXPIRES_IN ?? "12h");
  }

  /**
   * Table tokens are very long-lived because the QR is a physical artifact
   * and rotating every few hours would require reprinting. Mesa tokens are
   * narrowly scoped (only identify `table_id`) so the blast radius of a
   * leaked one is low — they cannot open sessions cross-table, cannot access
   * bills, and are invalidated by rotating `JWT_SECRET` if needed.
   */
  signTable(payload: Omit<TableTokenPayload, "kind">): string {
    const claims: TableTokenPayload = { ...payload, kind: "table" };
    return this.sign(claims, "365d");
  }

  signSession(payload: Omit<SessionTokenPayload, "kind">): string {
    const claims: SessionTokenPayload = { ...payload, kind: "session" };
    return this.sign(claims, process.env.JWT_SESSION_EXPIRES_IN ?? "6h");
  }

  verify(token: string): AuthPayload {
    try {
      const payload = this.jwt.verify<AuthPayload>(token);
      if (
        payload.kind !== "admin" &&
        payload.kind !== "table" &&
        payload.kind !== "session"
      ) {
        throw new UnauthorizedException({
          message: "Invalid token kind",
          code: "AUTH_INVALID_KIND",
        });
      }
      return payload;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException({
        message: "Invalid or expired token",
        code: "AUTH_INVALID_TOKEN",
      });
    }
  }
}
