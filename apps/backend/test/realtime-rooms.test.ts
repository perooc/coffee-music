/**
 * Integration test for socket auth + room scoping (Phase G5).
 *
 * Boots a real in-memory socket.io server attached to RealtimeGateway with
 * the token middleware installed and verifies:
 *   - anonymous sockets only receive `global` events
 *   - session tokens auto-join their own session room, cannot join others
 *   - admin tokens auto-join STAFF_ROOM
 *   - `:join` handlers reject mismatched or missing auth
 *   - staff-scoped emissions do NOT reach anonymous or other-session sockets
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, Server as HttpServer } from "http";
import { AddressInfo } from "net";
import { Server as IoServer } from "socket.io";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import { JwtService } from "@nestjs/jwt";
import { RealtimeGateway } from "../src/modules/realtime/realtime.gateway";
import { TokenService } from "../src/modules/auth/token.service";

const TEST_SECRET = "realtime-test-secret";
process.env.JWT_SECRET = TEST_SECRET;

let httpServer: HttpServer;
let ioServer: IoServer;
let gateway: RealtimeGateway;
let tokens: TokenService;
let port: number;

function connectClient(opts?: { token?: string }): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const sock = ioc(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      auth: opts?.token ? { token: opts.token } : undefined,
    });
    sock.on("connect", () => resolve(sock));
    sock.on("connect_error", (err) => reject(err));
  });
}

function waitForEvent<T>(
  sock: ClientSocket,
  event: string,
  timeoutMs = 200,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sock.off(event);
      resolve(null);
    }, timeoutMs);
    sock.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function emitFromClient(
  sock: ClientSocket,
  event: string,
  payload?: unknown,
) {
  sock.emit(event, payload);
  // Give the server a tick to process before emissions targeting rooms.
  await new Promise((r) => setTimeout(r, 25));
}

beforeAll(async () => {
  const jwt = new JwtService({ secret: TEST_SECRET });
  tokens = new TokenService(jwt);
  gateway = new RealtimeGateway(tokens);

  httpServer = createServer();
  ioServer = new IoServer(httpServer, { cors: { origin: "*" } });
  (gateway as unknown as { server: IoServer }).server = ioServer;

  // Install the same server.use middleware the gateway's afterInit would.
  gateway.afterInit(ioServer);

  // Wire @SubscribeMessage handlers manually since we are not booting Nest.
  ioServer.on("connection", (socket) => {
    gateway.handleConnection(socket);
    socket.on("tableSession:join", (sessionId: number) => {
      gateway.handleTableSessionJoin(sessionId, socket);
    });
    socket.on("tableSession:leave", (sessionId: number) => {
      gateway.handleTableSessionLeave(sessionId, socket);
    });
    socket.on("staff:join", () => {
      gateway.handleStaffJoin(socket);
    });
    socket.on("table:join", () => {
      gateway.handleTableJoin(socket);
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  ioServer.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("Phase G5 · socket auth + room scoping", () => {
  it("anonymous sockets receive global events", async () => {
    const anon = await connectClient();
    const p = waitForEvent(anon, "queue:updated");
    gateway.emitQueueUpdated({ kind: "test" });
    expect(await p).toEqual({ kind: "test" });
    anon.close();
  });

  it("anonymous sockets do NOT receive staff or session events", async () => {
    const anon = await connectClient();

    const staffProm = waitForEvent(anon, "order:updated");
    const sessionProm = waitForEvent(anon, "bill:updated");

    gateway.emitOrderUpdated(42, { id: 1 });
    gateway.emitBillUpdated(42, { session_id: 42 });

    expect(await staffProm).toBeNull();
    expect(await sessionProm).toBeNull();
    anon.close();
  });

  it("session token auto-joins its own session room", async () => {
    const token = tokens.signSession({ session_id: 100, table_id: 7 });
    const customer = await connectClient({ token });

    const p = waitForEvent<{ x: number }>(customer, "bill:updated");
    gateway.emitBillUpdated(100, { x: 1 });
    expect(await p).toEqual({ x: 1 });
    customer.close();
  });

  it("session token does NOT receive events from other sessions", async () => {
    const token = tokens.signSession({ session_id: 200, table_id: 1 });
    const customer = await connectClient({ token });

    const p = waitForEvent(customer, "bill:updated");
    gateway.emitBillUpdated(201, { x: "other" });
    expect(await p).toBeNull();
    customer.close();
  });

  it("session token cannot join another session via tableSession:join", async () => {
    const token = tokens.signSession({ session_id: 300, table_id: 1 });
    const customer = await connectClient({ token });

    const denyProm = waitForEvent<{ event: string; reason: string }>(
      customer,
      "auth:denied",
    );
    await emitFromClient(customer, "tableSession:join", 999);

    const deny = await denyProm;
    expect(deny?.event).toBe("tableSession:join");
    expect(deny?.reason).toMatch(/cross-session/);

    // Also confirm they did NOT receive events for that other session.
    const p = waitForEvent(customer, "bill:updated");
    gateway.emitBillUpdated(999, { x: 1 });
    expect(await p).toBeNull();

    customer.close();
  });

  it("admin token auto-joins STAFF_ROOM and receives staff events", async () => {
    const token = tokens.signAdmin({ sub: 1, name: "Admin", role: "admin" });
    const admin = await connectClient({ token });

    const p = waitForEvent(admin, "order-request:created");
    gateway.emitOrderRequestCreated(42, { req: "x" });
    expect(await p).toEqual({ req: "x" });
    admin.close();
  });

  it("staff:join is denied for anonymous sockets", async () => {
    const anon = await connectClient();
    const denyProm = waitForEvent<{ event: string; reason: string }>(
      anon,
      "auth:denied",
    );
    await emitFromClient(anon, "staff:join");
    const deny = await denyProm;
    expect(deny?.event).toBe("staff:join");
    expect(deny?.reason).toBe("anonymous");
    anon.close();
  });

  it("staff:join is denied for session sockets", async () => {
    const token = tokens.signSession({ session_id: 10, table_id: 1 });
    const customer = await connectClient({ token });
    const denyProm = waitForEvent<{ event: string; reason: string }>(
      customer,
      "auth:denied",
    );
    await emitFromClient(customer, "staff:join");
    const deny = await denyProm;
    expect(deny?.event).toBe("staff:join");
    expect(deny?.reason).toMatch(/kind=session/);
    customer.close();
  });

  it("invalid token at handshake is rejected (connect_error)", async () => {
    await expect(
      connectClient({ token: "not.a.valid.jwt" }),
    ).rejects.toThrow(/socket auth/);
  });

  it("global events reach everyone regardless of auth", async () => {
    const anon = await connectClient();
    const admin = await connectClient({
      token: tokens.signAdmin({ sub: 1, name: "A", role: "admin" }),
    });
    const customer = await connectClient({
      token: tokens.signSession({ session_id: 500, table_id: 3 }),
    });

    const anonP = waitForEvent(anon, "queue:updated");
    const adminP = waitForEvent(admin, "queue:updated");
    const custP = waitForEvent(customer, "queue:updated");

    gateway.emitQueueUpdated({ kind: "global" });

    expect(await anonP).toEqual({ kind: "global" });
    expect(await adminP).toEqual({ kind: "global" });
    expect(await custP).toEqual({ kind: "global" });

    anon.close();
    admin.close();
    customer.close();
  });

  it("leaving a session room stops session-channel delivery for that session", async () => {
    const token = tokens.signSession({ session_id: 600, table_id: 2 });
    const customer = await connectClient({ token });

    const first = waitForEvent(customer, "order:updated");
    gateway.emitOrderUpdated(600, { id: 1 });
    expect(await first).toEqual({ id: 1 });

    await emitFromClient(customer, "tableSession:leave", 600);

    const second = waitForEvent(customer, "order:updated");
    gateway.emitOrderUpdated(600, { id: 2 });
    expect(await second).toBeNull();

    customer.close();
  });

  it("session channel without sessionId throws (programmer error)", () => {
    expect(() =>
      (
        gateway as unknown as {
          dispatch: (e: {
            channel: string;
            event: string;
            payload: unknown;
          }) => void;
        }
      ).dispatch({ channel: "session", event: "x", payload: {} }),
    ).toThrow(/sessionId/);
  });
});
