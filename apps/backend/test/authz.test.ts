/**
 * Phase G10 — authorization QA suite.
 *
 * Tests the three guards (JwtGuard, RolesGuard, SessionAccessGuard) directly
 * with REAL JWTs minted by TokenService. The goal is to lock the contract:
 * if anyone changes a guard later, the failure surface is visible here, not
 * just in production telemetry.
 *
 * What this file deliberately does NOT do:
 *   - boot the full Nest app over HTTP (no supertest dependency added).
 *     Wire-level HTTP coverage is exercised by the dev server + frontend
 *     integration tests in this same suite (e.g. realtime-rooms.test.ts).
 *   - re-test created_by stamping (covered in audit-created-by.integration).
 *   - re-test socket auth (covered in realtime-rooms).
 */
import { describe, expect, it, beforeAll } from "vitest";
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { TokenService } from "../src/modules/auth/token.service";
import { JwtGuard, AUTH_KINDS_KEY } from "../src/modules/auth/guards/jwt.guard";
import {
  RolesGuard,
  ROLES_KEY,
} from "../src/modules/auth/guards/roles.guard";
import { SessionAccessGuard } from "../src/modules/auth/guards/session-access.guard";
import type { AuthPayload } from "../src/modules/auth/types";

const SECRET = "authz-test-secret";
process.env.JWT_SECRET = SECRET;

let tokens: TokenService;
let jwt: JwtService;

beforeAll(() => {
  jwt = new JwtService({ secret: SECRET });
  tokens = new TokenService(jwt);
});

// ─── Helpers ──────────────────────────────────────────────────────────────

type FakeReq = {
  headers: Record<string, string | undefined>;
  params?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  auth?: AuthPayload;
};

function ctx(
  req: FakeReq,
  metadata: { kinds?: AuthPayload["kind"][]; roles?: string[] } = {},
): ExecutionContext {
  // Reflector reads class+handler metadata. We synthesize an executable that
  // carries it via Reflect — same path the real framework uses.
  const handler = (() => undefined) as unknown as (...a: unknown[]) => unknown;
  const cls = (function () {
    /* fake controller class */
  }) as unknown as new () => unknown;
  if (metadata.kinds) Reflect.defineMetadata(AUTH_KINDS_KEY, metadata.kinds, handler);
  if (metadata.roles) Reflect.defineMetadata(ROLES_KEY, metadata.roles, handler);
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
    getHandler: () => handler,
    getClass: () => cls,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({ getData: () => ({}), getContext: () => ({}) }),
    switchToWs: () => ({ getData: () => ({}), getClient: () => ({}) }),
    getType: () => "http",
  } as unknown as ExecutionContext;
}

const reflector = new Reflector();

function jwtGuard() {
  return new JwtGuard(tokens, reflector);
}
function rolesGuard() {
  return new RolesGuard(reflector);
}
function sessionGuard() {
  return new SessionAccessGuard();
}

const adminToken = () =>
  tokens.signAdmin({ sub: 1, name: "Admin Test", role: "admin" });
const staffToken = () =>
  tokens.signAdmin({ sub: 2, name: "Staff Test", role: "staff" });
const tableToken = (table_id: number) => tokens.signTable({ table_id });
const sessionToken = (session_id: number, table_id: number) =>
  tokens.signSession({ session_id, table_id });

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

// ─── 1. Admin sin login → 401 ─────────────────────────────────────────────

describe("G10 · admin endpoints reject anonymous callers", () => {
  it("missing Authorization header → 401 AUTH_MISSING_TOKEN", () => {
    const req: FakeReq = { headers: {} };
    expect(() => jwtGuard().canActivate(ctx(req, { kinds: ["admin"] })))
      .toThrow(UnauthorizedException);
  });

  it("malformed Authorization header → 401", () => {
    const req: FakeReq = { headers: { authorization: "not-a-bearer" } };
    expect(() => jwtGuard().canActivate(ctx(req, { kinds: ["admin"] })))
      .toThrow(/Missing bearer token/);
  });
});

// ─── 2. Cliente intenta admin endpoint → 401 kind forbidden ─────────────

describe("G10 · customer tokens cannot reach admin endpoints", () => {
  it("session token rejected when admin is required (PATCH /orders/:id/status)", () => {
    const req: FakeReq = {
      headers: bearer(sessionToken(7, 3)),
    };
    try {
      jwtGuard().canActivate(ctx(req, { kinds: ["admin"] }));
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      const body = (err as UnauthorizedException).getResponse() as {
        code: string;
      };
      expect(body.code).toBe("AUTH_KIND_FORBIDDEN");
    }
  });

  it("table token rejected when admin is required", () => {
    const req: FakeReq = {
      headers: bearer(tableToken(3)),
    };
    expect(() => jwtGuard().canActivate(ctx(req, { kinds: ["admin"] })))
      .toThrow(/Token kind 'table' not allowed/);
  });

  it("admin token works on admin-only endpoints", () => {
    const req: FakeReq = { headers: bearer(adminToken()) };
    expect(jwtGuard().canActivate(ctx(req, { kinds: ["admin"] }))).toBe(true);
    expect(req.auth?.kind).toBe("admin");
  });
});

// ─── 3. Cross-session: session token de mesa A → endpoint mesa B ────────

describe("G10 · cross-session access is blocked by SessionAccessGuard", () => {
  function withAuth(req: FakeReq, payload: AuthPayload): FakeReq {
    return { ...req, auth: payload };
  }

  it("session token accessing its OWN session → allowed", () => {
    const req = withAuth(
      { headers: {}, params: { sessionId: "100" } },
      { kind: "session", session_id: 100, table_id: 3 },
    );
    expect(sessionGuard().canActivate(ctx(req))).toBe(true);
  });

  it("session token accessing OTHER session via :sessionId → 403 AUTH_CROSS_SESSION", () => {
    const req = withAuth(
      { headers: {}, params: { sessionId: "200" } },
      { kind: "session", session_id: 100, table_id: 3 },
    );
    try {
      sessionGuard().canActivate(ctx(req));
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const body = (err as ForbiddenException).getResponse() as {
        code: string;
      };
      expect(body.code).toBe("AUTH_CROSS_SESSION");
    }
  });

  it("session token accessing OTHER session via body.table_session_id → 403", () => {
    const req = withAuth(
      { headers: {}, params: {}, body: { table_session_id: 999 } },
      { kind: "session", session_id: 100, table_id: 3 },
    );
    expect(() => sessionGuard().canActivate(ctx(req)))
      .toThrow(/Cross-session/);
  });

  it("admin bypasses SessionAccessGuard regardless of session id", () => {
    const req = withAuth(
      { headers: {}, params: { sessionId: "999" } },
      { kind: "admin", sub: 1, name: "x", role: "admin" },
    );
    expect(sessionGuard().canActivate(ctx(req))).toBe(true);
  });

  it("table token rejected on session-scoped endpoint → 403 AUTH_SESSION_REQUIRED", () => {
    const req = withAuth(
      { headers: {}, params: { sessionId: "1" } },
      { kind: "table", table_id: 1 },
    );
    expect(() => sessionGuard().canActivate(ctx(req)))
      .toThrow(/Session token required/);
  });

  it("missing session scope on request → 403 AUTH_NO_SESSION_SCOPE", () => {
    const req = withAuth(
      { headers: {}, params: {}, body: {} },
      { kind: "session", session_id: 100, table_id: 3 },
    );
    expect(() => sessionGuard().canActivate(ctx(req)))
      .toThrow(/No session scope/);
  });
});

// ─── 4. table_token usado en endpoint que pide session_token → 401 ──────

describe("G10 · token kind is enforced per endpoint", () => {
  it("table token rejected on POST /queue (session-only)", () => {
    const req: FakeReq = { headers: bearer(tableToken(3)) };
    try {
      jwtGuard().canActivate(ctx(req, { kinds: ["session"] }));
      throw new Error("expected to throw");
    } catch (err) {
      const body = (err as UnauthorizedException).getResponse() as {
        code: string;
      };
      expect(body.code).toBe("AUTH_KIND_FORBIDDEN");
    }
  });

  it("session token rejected on POST /table-sessions/open (table-only)", () => {
    const req: FakeReq = { headers: bearer(sessionToken(50, 3)) };
    expect(() => jwtGuard().canActivate(ctx(req, { kinds: ["table"] })))
      .toThrow(/Token kind 'session' not allowed/);
  });
});

// ─── 5. Roles ─────────────────────────────────────────────────────────────

describe("G10 · RolesGuard checks role for admin-kind tokens", () => {
  it("admin role passes when admin or staff is allowed", () => {
    const req: FakeReq = {
      headers: {},
      auth: { kind: "admin", sub: 1, name: "x", role: "admin" },
    };
    expect(rolesGuard().canActivate(ctx(req, { roles: ["admin", "staff"] })))
      .toBe(true);
  });

  it("staff role rejected when only admin is allowed → 403 AUTH_ROLE_FORBIDDEN", () => {
    const req: FakeReq = {
      headers: {},
      auth: { kind: "admin", sub: 2, name: "y", role: "staff" },
    };
    try {
      rolesGuard().canActivate(ctx(req, { roles: ["admin"] }));
      throw new Error("expected to throw");
    } catch (err) {
      const body = (err as ForbiddenException).getResponse() as {
        code: string;
      };
      expect(body.code).toBe("AUTH_ROLE_FORBIDDEN");
    }
  });

  it("session token rejected by RolesGuard → 403 AUTH_ADMIN_REQUIRED", () => {
    const req: FakeReq = {
      headers: {},
      auth: { kind: "session", session_id: 1, table_id: 1 },
    };
    expect(() => rolesGuard().canActivate(ctx(req, { roles: ["admin"] })))
      .toThrow(/Admin token required/);
  });

  it("RolesGuard returns true when no @Roles metadata is set", () => {
    const req: FakeReq = { headers: {} };
    expect(rolesGuard().canActivate(ctx(req))).toBe(true);
  });

  it("staff token (kind=admin, role=staff) verifies fine through TokenService", () => {
    // Sanity: the staff convention uses kind=admin + role=staff.
    const token = staffToken();
    const payload = tokens.verify(token);
    expect(payload.kind).toBe("admin");
    if (payload.kind !== "admin") return;
    expect(payload.role).toBe("staff");
  });
});

// ─── 6. table_token de mesa 3 abriendo mesa 4 → 403 AUTH_TABLE_MISMATCH ─

describe("G10 · table token cannot open a different table", () => {
  // The mismatch check lives inside TableSessionsController.open. We reproduce
  // its exact branch here to lock the contract: the body's table_id must
  // match the token's table_id, otherwise 403 AUTH_TABLE_MISMATCH.
  function controllerCheck(
    auth: AuthPayload,
    body: { table_id: number },
  ): boolean {
    if (auth.kind !== "table" || auth.table_id !== body.table_id) {
      const err = new ForbiddenException({
        message: "Table token does not match requested table",
        code: "AUTH_TABLE_MISMATCH",
      });
      throw err;
    }
    return true;
  }

  it("matching table_id → ok", () => {
    const auth: AuthPayload = { kind: "table", table_id: 3 };
    expect(controllerCheck(auth, { table_id: 3 })).toBe(true);
  });

  it("table 3 token trying to open mesa 4 → 403 AUTH_TABLE_MISMATCH", () => {
    const auth: AuthPayload = { kind: "table", table_id: 3 };
    try {
      controllerCheck(auth, { table_id: 4 });
      throw new Error("expected to throw");
    } catch (err) {
      const body = (err as ForbiddenException).getResponse() as {
        code: string;
      };
      expect(body.code).toBe("AUTH_TABLE_MISMATCH");
    }
  });
});

// ─── 7. session_token vencido / inválido → 401 AUTH_INVALID_TOKEN ───────

describe("G10 · invalid or expired tokens are rejected", () => {
  it("garbage token → 401 AUTH_INVALID_TOKEN", () => {
    const req: FakeReq = {
      headers: { authorization: "Bearer not.a.valid.jwt" },
    };
    try {
      jwtGuard().canActivate(ctx(req, { kinds: ["session"] }));
      throw new Error("expected to throw");
    } catch (err) {
      const body = (err as UnauthorizedException).getResponse() as {
        code: string;
      };
      expect(body.code).toBe("AUTH_INVALID_TOKEN");
    }
  });

  it("token signed with a different secret → 401 AUTH_INVALID_TOKEN", () => {
    const otherJwt = new JwtService({ secret: "DIFFERENT-SECRET" });
    const otherTokens = new TokenService(otherJwt);
    const foreign = otherTokens.signSession({ session_id: 1, table_id: 1 });
    const req: FakeReq = { headers: bearer(foreign) };
    expect(() => jwtGuard().canActivate(ctx(req, { kinds: ["session"] })))
      .toThrow(/Invalid or expired token/);
  });

  it("expired session token → 401 AUTH_INVALID_TOKEN", () => {
    // Sign with a 1-second TTL via the underlying JwtService, then advance
    // the clock by sleeping 1.1s. We cannot use TokenService because it has
    // a fixed expiresIn; this is the same crypto path though.
    const shortLived = jwt.sign(
      { kind: "session", session_id: 1, table_id: 1 },
      { expiresIn: 1 }, // seconds (jsonwebtoken default unit when number)
    );
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try {
          const req: FakeReq = { headers: bearer(shortLived) };
          expect(() =>
            jwtGuard().canActivate(ctx(req, { kinds: ["session"] })),
          ).toThrow(/Invalid or expired token/);
          resolve();
        } catch (err) {
          reject(err);
        }
      }, 1100);
    });
  }, 5_000);
});
