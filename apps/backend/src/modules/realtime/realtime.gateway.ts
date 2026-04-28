import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { TokenService } from "../auth/token.service";
import type { AuthPayload } from "../auth/types";

type Channel = "global" | "staff" | "session";

type EventPayload = {
  channel: Channel;
  event: string;
  payload: unknown;
  sessionId?: number;
};

const STAFF_ROOM = "staff";
const sessionRoom = (sessionId: number) => `tableSession:${sessionId}`;

/**
 * Socket authorization model (Phase G5):
 *
 *   - Anonymous connections ARE allowed. They can only receive `global`
 *     channel events (queue:updated, playback:updated). The TV player and
 *     landing pages rely on this.
 *   - Any `:join` handler checks `socket.data.auth`. Rooms are the perimeter:
 *     without a valid token, the client cannot join STAFF_ROOM, a session
 *     room, or the legacy table room.
 *   - Staff auto-join STAFF_ROOM on connect. Session clients auto-join their
 *     own session room. Table tokens are meaningful for HTTP but not for
 *     sockets, so they do not receive auto-join.
 *
 * Why verify at middleware time (server.use) rather than inside each handler:
 * cross-cuts every emission path, no controller can forget to check, and the
 * payload lives on `socket.data.auth` for the lifetime of the connection.
 */
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly tokens: TokenService) {}

  afterInit(server: Server) {
    // Verify token at handshake. Invalid tokens ⇒ anonymous. Missing token ⇒
    // anonymous. Only a PROVIDED-but-INVALID token is rejected: that case is
    // almost always a bug the client should learn about.
    server.use((socket, next) => {
      const token = this.readToken(socket);
      if (!token) {
        socket.data.auth = null;
        return next();
      }
      try {
        const payload = this.tokens.verify(token);
        socket.data.auth = payload;
        return next();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "invalid token";
        return next(new Error(`socket auth: ${msg}`));
      }
    });
  }

  handleConnection(client: Socket) {
    const auth = this.getAuth(client);
    if (auth?.kind === "admin") {
      void client.join(STAFF_ROOM);
      this.logger.log(
        `Client ${client.id} connected as admin (auto-joined ${STAFF_ROOM})`,
      );
      return;
    }
    if (auth?.kind === "session") {
      void client.join(sessionRoom(auth.session_id));
      this.logger.log(
        `Client ${client.id} connected as session ${auth.session_id}`,
      );
      return;
    }
    this.logger.log(
      `Client ${client.id} connected anonymously (global channel only)`,
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ─── Room subscriptions ───────────────────────────────────────────────────

  @SubscribeMessage("tableSession:join")
  handleTableSessionJoin(
    @MessageBody() sessionId: number,
    @ConnectedSocket() client: Socket,
  ) {
    const auth = this.getAuth(client);
    if (!auth) return this.denyJoin(client, "tableSession:join", "anonymous");
    if (auth.kind === "admin") {
      void client.join(sessionRoom(sessionId));
      return;
    }
    if (auth.kind !== "session") {
      return this.denyJoin(client, "tableSession:join", `kind=${auth.kind}`);
    }
    if (auth.session_id !== sessionId) {
      return this.denyJoin(
        client,
        "tableSession:join",
        `cross-session ${auth.session_id} → ${sessionId}`,
      );
    }
    // Already auto-joined at connect, but re-joining after a room leave is
    // legitimate — idempotent.
    void client.join(sessionRoom(sessionId));
  }

  @SubscribeMessage("tableSession:leave")
  handleTableSessionLeave(
    @MessageBody() sessionId: number,
    @ConnectedSocket() client: Socket,
  ) {
    // Leaving a room never needs auth: worst case, a client leaves a room
    // they were never in, which is a no-op.
    void client.leave(sessionRoom(sessionId));
  }

  @SubscribeMessage("staff:join")
  handleStaffJoin(@ConnectedSocket() client: Socket) {
    const auth = this.getAuth(client);
    if (!auth || auth.kind !== "admin") {
      return this.denyJoin(client, "staff:join", auth ? `kind=${auth.kind}` : "anonymous");
    }
    void client.join(STAFF_ROOM);
  }

  @SubscribeMessage("table:join")
  handleTableJoin(@ConnectedSocket() client: Socket) {
    // Legacy table room is no longer used by any new emitter. We accept
    // the message for back-compat but refuse to join without admin auth.
    const auth = this.getAuth(client);
    if (!auth || auth.kind !== "admin") {
      return this.denyJoin(client, "table:join", auth ? `kind=${auth.kind}` : "anonymous");
    }
    // Admin joining the legacy table room is a no-op in the new model.
    // We log and silently ignore instead of joining, so we stop leaking the
    // legacy surface to new clients.
    this.logger.debug(`Legacy table:join from admin ${client.id} ignored`);
  }

  // ─── Channel layer ────────────────────────────────────────────────────────

  private dispatch(evt: EventPayload) {
    const { channel, event, payload, sessionId } = evt;
    switch (channel) {
      case "global":
        this.server.emit(event, payload);
        return;
      case "staff":
        // Room-scoped now that staff auto-joins on connect. Anonymous and
        // customer sockets never receive staff-channel events.
        this.server.to(STAFF_ROOM).emit(event, payload);
        return;
      case "session":
        if (sessionId == null) {
          throw new Error(`session channel requires sessionId (event=${event})`);
        }
        this.server.to(sessionRoom(sessionId)).emit(event, payload);
        return;
    }
  }

  private emitToSession(sessionId: number, event: string, payload: unknown) {
    this.dispatch({ channel: "session", event, payload, sessionId });
  }

  private emitToStaff(event: string, payload: unknown) {
    this.dispatch({ channel: "staff", event, payload });
  }

  private emitGlobal(event: string, payload: unknown) {
    this.dispatch({ channel: "global", event, payload });
  }

  // ─── Public emitters ──────────────────────────────────────────────────────

  emitBillUpdated(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "bill:updated", payload);
    this.emitToStaff("bill:updated", payload);
  }

  emitOrderCreated(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "order:created", payload);
    this.emitToStaff("order:created", payload);
  }

  emitOrderUpdated(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "order:updated", payload);
    this.emitToStaff("order:updated", payload);
  }

  emitOrderRequestCreated(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "order-request:created", payload);
    this.emitToStaff("order-request:created", payload);
  }

  emitOrderRequestUpdated(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "order-request:updated", payload);
    this.emitToStaff("order-request:updated", payload);
  }

  emitTableSessionOpened(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "table-session:opened", payload);
    this.emitToStaff("table-session:opened", payload);
  }

  emitTableSessionUpdated(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "table-session:updated", payload);
    this.emitToStaff("table-session:updated", payload);
  }

  emitTableSessionClosed(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "table-session:closed", payload);
    this.emitToStaff("table-session:closed", payload);
  }

  emitTableUpdated(payload: unknown) {
    this.emitToStaff("table:updated", payload);
    this.emitGlobal("table:updated", payload);
  }

  emitQueueUpdated(payload: unknown) {
    this.emitGlobal("queue:updated", payload);
  }

  emitPlaybackUpdated(payload: unknown) {
    this.emitGlobal("playback:updated", payload);
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private readToken(socket: Socket): string | null {
    const raw =
      (socket.handshake.auth as Record<string, unknown> | undefined)?.token ??
      socket.handshake.query?.token;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    return null;
  }

  private getAuth(client: Socket): AuthPayload | null {
    const auth = client.data.auth as AuthPayload | null | undefined;
    return auth ?? null;
  }

  private denyJoin(client: Socket, event: string, reason: string) {
    this.logger.warn(`DENY ${event} from ${client.id}: ${reason}`);
    client.emit("auth:denied", { event, reason });
  }
}
