import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

/**
 * Ensures a session-scoped customer request targets *its own* session.
 *
 * - admin tokens bypass this guard (staff can read/act on any session).
 * - session tokens must match `sessionId` (from route param or body).
 * - table tokens are rejected here; they cannot read session-scoped data.
 *
 * Expects the route to expose a session id at one of:
 *   req.params.sessionId
 *   req.params.id           (when the controller mounts under /bill/:id etc.)
 *   req.body.table_session_id
 *   req.query.table_session_id
 */
@Injectable()
export class SessionAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.auth;
    if (!auth) {
      throw new ForbiddenException({
        message: "Missing auth payload",
        code: "AUTH_MISSING",
      });
    }
    if (auth.kind === "admin") return true;
    if (auth.kind !== "session") {
      throw new ForbiddenException({
        message: "Session token required",
        code: "AUTH_SESSION_REQUIRED",
      });
    }

    const targetId = this.extractSessionId(req);
    if (targetId == null) {
      // No session id on the request — deny rather than allow-by-default.
      throw new ForbiddenException({
        message: "No session scope on request",
        code: "AUTH_NO_SESSION_SCOPE",
      });
    }
    if (targetId !== auth.session_id) {
      throw new ForbiddenException({
        message: "Cross-session access denied",
        code: "AUTH_CROSS_SESSION",
      });
    }
    return true;
  }

  private extractSessionId(req: Request): number | null {
    const params = req.params as Record<string, string | undefined>;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = (req.query ?? {}) as Record<string, unknown>;

    const candidates: unknown[] = [
      params.sessionId,
      params.id,
      body.table_session_id,
      query.table_session_id,
    ];
    for (const c of candidates) {
      if (c == null) continue;
      const n = Number(c);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }
}
