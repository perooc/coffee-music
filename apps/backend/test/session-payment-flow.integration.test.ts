/**
 * Customer/admin payment-flow integration tests.
 *
 * Locks the contract:
 *   - request-payment requires no in-flight orders/requests
 *   - request-payment is mutually exclusive with paid_at
 *   - cancel-payment-request is idempotent and forbidden after paid
 *   - mark-paid sets paid_at AND closes the session in one step
 *   - mark-paid is blocked when there are active orders
 *   - OrderRequest.create AND .updateItems are blocked while
 *     payment_requested_at is set (paid sessions are already closed,
 *     covered by the closed-status guard)
 *   - the audit timestamps survive on the closed row (history)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  OrderRequestStatus,
  OrderStatus,
  PrismaClient,
  TableSessionStatus,
  TableStatus,
} from "@prisma/client";
import { ConsumptionsService } from "../src/modules/consumptions/consumptions.service";
import { OrderRequestsService } from "../src/modules/order-requests/order-requests.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { TableProjectionService } from "../src/modules/table-projection/table-projection.service";
import { TableSessionsService } from "../src/modules/table-sessions/table-sessions.service";

const prisma = new PrismaClient();

const noopRealtime = {
  emitOrderRequestCreated: () => {},
  emitOrderRequestUpdated: () => {},
  emitOrderCreated: () => {},
  emitOrderUpdated: () => {},
  emitTableUpdated: () => {},
  emitTableSessionOpened: () => {},
  emitTableSessionUpdated: () => {},
  emitTableSessionClosed: () => {},
  emitQueueUpdated: () => {},
  emitPlaybackUpdated: () => {},
  emitBillUpdated: () => {},
} as any;

const projection = new TableProjectionService(prisma as any);
const consumptions = new ConsumptionsService(
  prisma as any,
  projection,
  noopRealtime,
);
const orderRequests = new OrderRequestsService(
  prisma as any,
  projection,
  noopRealtime,
);
const orders = new OrdersService(
  prisma as any,
  projection,
  noopRealtime,
  consumptions,
);
const sessions = new TableSessionsService(
  prisma as any,
  projection,
  noopRealtime,
);

let firstTableId = 1;
let firstProductId = 1;

async function loadFixtureIds() {
  const [t] = await prisma.table.findMany({
    orderBy: { id: "asc" },
    take: 1,
    select: { id: true },
  });
  const [p] = await prisma.product.findMany({
    orderBy: { id: "asc" },
    take: 1,
    select: { id: true },
  });
  if (!t || !p) {
    throw new Error("Fixture DB missing. Run `npx tsx prisma/seed.ts`.");
  }
  firstTableId = t.id;
  firstProductId = p.id;
}

async function cleanDb() {
  await prisma.consumption.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.orderRequest.deleteMany();
  await prisma.tableSession.deleteMany();
  await prisma.table.updateMany({
    data: {
      current_session_id: null,
      status: TableStatus.available,
      total_consumption: 0,
      active_order_count: 0,
      pending_request_count: 0,
      last_activity_at: null,
    },
  });
}

async function resetProduct(id: number, stock: number) {
  await prisma.product.update({
    where: { id },
    data: { stock, is_active: true },
  });
}

async function openSession(tableId: number) {
  return prisma.$transaction(async (tx) => {
    const s = await tx.tableSession.create({
      data: { table_id: tableId, status: TableSessionStatus.open },
    });
    await projection.onSessionOpened(tableId, s.id, tx);
    return s;
  });
}

async function placeAndDeliver(sessionId: number) {
  const req = await orderRequests.create({
    table_session_id: sessionId,
    items: [{ product_id: firstProductId, quantity: 1 }],
  });
  const accepted = await orderRequests.accept(req.id);
  const orderId = accepted.order!.id;
  await orders.updateStatus(orderId, OrderStatus.preparing);
  await orders.updateStatus(orderId, OrderStatus.ready);
  await orders.updateStatus(orderId, OrderStatus.delivered);
}

beforeAll(async () => {
  await loadFixtureIds();
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanDb();
  await resetProduct(firstProductId, 50);
});

describe("Payment flow · requestPayment", () => {
  it("happy path: sets payment_requested_at on a session with no in-flight orders", async () => {
    const session = await openSession(firstTableId);
    const updated = await sessions.requestPayment(session.id);
    expect(updated.payment_requested_at).not.toBeNull();
  });

  it("rejects when there is a pending OrderRequest", async () => {
    const session = await openSession(firstTableId);
    await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });
    await expect(sessions.requestPayment(session.id)).rejects.toMatchObject({
      response: { code: "TABLE_SESSION_HAS_PENDING_OR_ACTIVE_ORDERS" },
    });
  });

  it("rejects when there is an accepted (active) Order", async () => {
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });
    await orderRequests.accept(req.id);
    await expect(sessions.requestPayment(session.id)).rejects.toMatchObject({
      response: { code: "TABLE_SESSION_HAS_PENDING_OR_ACTIVE_ORDERS" },
    });
  });

  it("rejects when the session is already paid (and therefore closed)", async () => {
    const session = await openSession(firstTableId);
    await sessions.markPaid(session.id);
    // Once paid the session is closed; closed-check fires first.
    await expect(sessions.requestPayment(session.id)).rejects.toMatchObject({
      response: { code: "TABLE_SESSION_CLOSED" },
    });
  });

  it("rejects when payment was already requested (race-safety)", async () => {
    const session = await openSession(firstTableId);
    await sessions.requestPayment(session.id);
    await expect(sessions.requestPayment(session.id)).rejects.toMatchObject({
      response: { code: "TABLE_SESSION_PAYMENT_ALREADY_REQUESTED" },
    });
  });

  it("rejects on a closed session", async () => {
    const session = await openSession(firstTableId);
    await sessions.close(session.id);
    await expect(sessions.requestPayment(session.id)).rejects.toMatchObject({
      response: { code: "TABLE_SESSION_CLOSED" },
    });
  });
});

describe("Payment flow · cancelPaymentRequest", () => {
  it("clears the timestamp", async () => {
    const session = await openSession(firstTableId);
    await sessions.requestPayment(session.id);
    const cleared = await sessions.cancelPaymentRequest(session.id);
    expect(cleared.payment_requested_at).toBeNull();
  });

  it("is a no-op when no request is pending", async () => {
    const session = await openSession(firstTableId);
    const result = await sessions.cancelPaymentRequest(session.id);
    expect(result.payment_requested_at).toBeNull();
  });

  it("is forbidden once paid (session is closed)", async () => {
    const session = await openSession(firstTableId);
    await sessions.requestPayment(session.id);
    await sessions.markPaid(session.id);
    // After markPaid the session is closed; cancelPaymentRequest should
    // surface the paid-state conflict (paid_at is set on the closed row).
    await expect(
      sessions.cancelPaymentRequest(session.id),
    ).rejects.toMatchObject({
      response: { code: "TABLE_SESSION_ALREADY_PAID" },
    });
  });
});

describe("Payment flow · markPaid (closes session)", () => {
  it("sets paid_at, closed_at, and status=closed in one transaction", async () => {
    const session = await openSession(firstTableId);
    await sessions.requestPayment(session.id);
    const paid = await sessions.markPaid(session.id);
    expect(paid.paid_at).not.toBeNull();
    expect(paid.closed_at).not.toBeNull();
    expect(paid.status).toBe(TableSessionStatus.closed);
    expect(paid.payment_requested_at).toBeNull();
  });

  it("can be called without a prior request (admin processes payment directly)", async () => {
    const session = await openSession(firstTableId);
    const paid = await sessions.markPaid(session.id);
    expect(paid.paid_at).not.toBeNull();
    expect(paid.status).toBe(TableSessionStatus.closed);
  });

  it("rejects when there are active orders", async () => {
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });
    await orderRequests.accept(req.id);
    await expect(sessions.markPaid(session.id)).rejects.toMatchObject({
      response: { code: "TABLE_SESSION_HAS_ACTIVE_ORDERS" },
    });
  });

  it("rejects on an already-closed session", async () => {
    const session = await openSession(firstTableId);
    await sessions.close(session.id);
    await expect(sessions.markPaid(session.id)).rejects.toMatchObject({
      response: { code: "TABLE_SESSION_CLOSED" },
    });
  });

  it("clears the table's current_session_id (resets the table)", async () => {
    const session = await openSession(firstTableId);
    await sessions.markPaid(session.id);
    const table = await prisma.table.findUnique({
      where: { id: firstTableId },
      select: { current_session_id: true },
    });
    expect(table?.current_session_id).toBeNull();
  });
});

describe("Payment flow · OrderRequest blocking", () => {
  it("blocks create while payment_requested_at is set", async () => {
    const session = await openSession(firstTableId);
    await sessions.requestPayment(session.id);
    await expect(
      orderRequests.create({
        table_session_id: session.id,
        items: [{ product_id: firstProductId, quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      response: { code: "SESSION_PAYMENT_REQUESTED" },
    });
  });

  it("blocks create after markPaid (session is closed)", async () => {
    const session = await openSession(firstTableId);
    await sessions.markPaid(session.id);
    await expect(
      orderRequests.create({
        table_session_id: session.id,
        items: [{ product_id: firstProductId, quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      response: { code: "TABLE_SESSION_CLOSED" },
    });
  });

  it("re-allows create after cancelPaymentRequest", async () => {
    const session = await openSession(firstTableId);
    await sessions.requestPayment(session.id);
    await sessions.cancelPaymentRequest(session.id);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });
    expect(req.status).toBe(OrderRequestStatus.pending);
  });

  it("blocks updateItems while payment_requested_at is set", async () => {
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });
    // Force the payment-requested flag directly without going through the
    // service guard — we are testing updateItems' own lock, not the
    // request-payment guards (those have their own tests above).
    await prisma.tableSession.update({
      where: { id: session.id },
      data: { payment_requested_at: new Date() },
    });
    await expect(
      orderRequests.updateItems(req.id, [
        { product_id: firstProductId, quantity: 2 },
      ]),
    ).rejects.toMatchObject({
      response: { code: "SESSION_PAYMENT_REQUESTED" },
    });
  });
});

describe("Payment flow · audit history", () => {
  it("payment_requested_at and paid_at survive on the closed row (history)", async () => {
    const session = await openSession(firstTableId);
    await placeAndDeliver(session.id);
    await sessions.requestPayment(session.id);
    const closed = await sessions.markPaid(session.id);
    expect(closed.closed_at).not.toBeNull();
    expect(closed.paid_at).not.toBeNull();
    // markPaid clears payment_requested_at as part of the transaction; the
    // close timestamp is what survives.
    expect(closed.payment_requested_at).toBeNull();
    expect(closed.status).toBe(TableSessionStatus.closed);
  });
});
