import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TableSessionsService } from "./table-sessions.service";
import { OpenSessionDto } from "./dto/open-session.dto";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";
import { SessionAccessGuard } from "../auth/guards/session-access.guard";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import { TokenService } from "../auth/token.service";
import type { AuthPayload } from "../auth/types";

@Controller()
export class TableSessionsController {
  constructor(
    private readonly sessions: TableSessionsService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Customer opens a session with the table token from the QR.
   *
   * Auth: table-kind JWT. Body's `table_id` must match the token's
   * `table_id` — this prevents a customer at mesa 3 from opening mesa 4.
   *
   * Returns the session *and* a freshly minted session token the client
   * will use from now on for bill/orders/requests/sockets.
   */
  @Post("table-sessions/open")
  @UseGuards(JwtGuard)
  @AuthKinds("table")
  async open(@Body() dto: OpenSessionDto, @CurrentAuth() auth: AuthPayload) {
    if (auth.kind !== "table" || auth.table_id !== dto.table_id) {
      throw new ForbiddenException({
        message: "Table token does not match requested table",
        code: "AUTH_TABLE_MISMATCH",
      });
    }
    const session = await this.sessions.open(dto.table_id);
    const session_token = this.tokens.signSession({
      session_id: session.id,
      table_id: session.table_id,
    });
    return {
      ...this.sessions.serialize(session),
      session_token,
    };
  }

  /**
   * Refresh the session token without closing the underlying session.
   *
   * Used by the customer client to recover from a stale `session_token`
   * (transient socket suspension on iOS, an expired JWT, etc.) without
   * dropping the customer's in-flight pedidos. The QR's `table_token` is
   * the source of authority — if its `table_id` still has an active
   * session, we mint a fresh `session_token` for that same session id.
   *
   * Returns 404 (TABLE_SESSION_NOT_OPEN) when the table has no active
   * session — that's the only legitimate "expired" case the client UI
   * should surface as such. Anything else is recoverable in the
   * background.
   */
  @Post("table-sessions/refresh")
  @UseGuards(JwtGuard)
  @AuthKinds("table")
  async refresh(@CurrentAuth() auth: AuthPayload) {
    if (auth.kind !== "table") {
      throw new ForbiddenException({
        message: "Table token required",
        code: "AUTH_TABLE_REQUIRED",
      });
    }
    const session = await this.sessions.getCurrentForTable(auth.table_id);
    if (!session || session.status === "closed") {
      throw new NotFoundException({
        message: `Table ${auth.table_id} has no open session`,
        code: "TABLE_SESSION_NOT_OPEN",
      });
    }
    const session_token = this.tokens.signSession({
      session_id: session.id,
      table_id: session.table_id,
    });
    return {
      ...this.sessions.serialize(session),
      session_token,
    };
  }

  /**
   * Admin opens a session for a table or virtual bar. Used when a
   * customer didn't (or can't) scan the QR — the staff starts the
   * session from the dashboard and a `custom_name` (e.g. "Camilo")
   * is attached so multiple parallel bar accounts can be told apart.
   *
   * Returns 200 even if a session was already open: idempotent join
   * matches the customer flow. The optional `custom_name` only takes
   * effect on a NEW session — we don't rename someone else's account.
   */
  @Post("admin/table-sessions/open")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async openByAdmin(@Body() dto: OpenSessionDto & { custom_name?: string }) {
    const session = await this.sessions.open(dto.table_id, {
      customName: dto.custom_name?.trim() || null,
      openedBy: "staff",
    });
    return this.sessions.serialize(session);
  }

  /**
   * Staff closes a session manually. Customer-driven close would need its
   * own flow; today `closing` status is the softer path for that.
   */
  @Post("table-sessions/:id/close")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async close(@Param("id", ParseIntPipe) id: number) {
    const session = await this.sessions.close(id);
    return this.sessions.serialize(session);
  }

  /**
   * Readable by admin (for the bill drawer) or by the session owner.
   * SessionAccessGuard enforces that a session-kind token's session_id
   * matches :id; admins bypass.
   */
  @Get("table-sessions/:id")
  @UseGuards(JwtGuard, SessionAccessGuard)
  @AuthKinds("admin", "session")
  async getById(@Param("id", ParseIntPipe) id: number) {
    const session = await this.sessions.getById(id);
    return this.sessions.serialize(session);
  }

  /**
   * Discovery endpoint for the customer. Needs a table token; the token's
   * table_id must match :id. No admin required (customers use this before
   * opening a session and therefore cannot yet present a session token).
   */
  @Get("tables/:id/session/current")
  @UseGuards(JwtGuard)
  @AuthKinds("table", "admin")
  async currentForTable(
    @Param("id", ParseIntPipe) id: number,
    @CurrentAuth() auth: AuthPayload,
  ) {
    if (auth.kind === "table" && auth.table_id !== id) {
      throw new ForbiddenException({
        message: "Table token does not match requested table",
        code: "AUTH_TABLE_MISMATCH",
      });
    }
    const session = await this.sessions.getCurrentForTable(id);
    if (!session) {
      throw new NotFoundException({
        message: `Table ${id} has no open session`,
        code: "TABLE_SESSION_NOT_OPEN",
      });
    }
    return this.sessions.serialize(session);
  }

  // ─── Payment flow ─────────────────────────────────────────────────────

  /**
   * Customer asks for the bill. SessionAccessGuard ensures the path
   * sessionId matches the token's session_id; admin bypasses.
   */
  @Post("table-sessions/:id/request-payment")
  @UseGuards(JwtGuard, SessionAccessGuard)
  @AuthKinds("session")
  async requestPayment(@Param("id", ParseIntPipe) id: number) {
    const session = await this.sessions.requestPayment(id);
    return this.sessions.serialize(session);
  }

  /**
   * Customer cancels their own pending payment request. Admin can also
   * call this in case of fat-finger but the typical flow is customer.
   */
  @Post("table-sessions/:id/cancel-payment-request")
  @UseGuards(JwtGuard, SessionAccessGuard)
  @AuthKinds("session", "admin")
  async cancelPaymentRequest(@Param("id", ParseIntPipe) id: number) {
    const session = await this.sessions.cancelPaymentRequest(id);
    return this.sessions.serialize(session);
  }

  /**
   * Admin records that the bill was paid AND closes the session in one
   * step. The customer must scan the QR again to start a new session.
   */
  @Post("table-sessions/:id/mark-paid")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async markPaid(@Param("id", ParseIntPipe) id: number) {
    const session = await this.sessions.markPaid(id);
    return this.sessions.serialize(session);
  }
}
