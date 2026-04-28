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
}
