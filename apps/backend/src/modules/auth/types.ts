import type { UserRole } from "@prisma/client";

/**
 * Three distinct token kinds distinguish which bearer is making a request.
 * Each kind has its own JWT payload shape and its own claim `kind` so the
 * server cannot be tricked into treating a table token as an admin token
 * (or vice versa).
 *
 * - admin:   staff/admin login, full backoffice surface.
 * - table:   printed on the physical QR. Identifies *which table* is scanning.
 *            No session context. Used to open/discover a session.
 * - session: minted after `POST /table-sessions/open`. Scoped to one live
 *            TableSession. Used for bill, orders, requests on that session.
 */
export type AdminTokenPayload = {
  kind: "admin";
  sub: number;
  name: string;
  role: UserRole;
};

export type TableTokenPayload = {
  kind: "table";
  table_id: number;
};

export type SessionTokenPayload = {
  kind: "session";
  session_id: number;
  table_id: number;
};

export type AuthPayload =
  | AdminTokenPayload
  | TableTokenPayload
  | SessionTokenPayload;

/** Attached to the Nest request by the guard on successful auth. */
declare module "express" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Request {
    auth?: AuthPayload;
  }
}
