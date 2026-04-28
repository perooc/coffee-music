/**
 * Integration tests for Phase C: OrderRequest / Order split.
 *
 * These hit the real Postgres (from .env DATABASE_URL) and exercise the full
 * transactional flow through the services. They cover the 5 cases required
 * before closing Phase C.
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

const prisma = new PrismaClient();

let firstTableId = 1;
let secondTableId = 2;
let firstProductId = 1;
async function loadFixtureIds() {
  const tables = await prisma.table.findMany({
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });
  const products = await prisma.product.findMany({
    orderBy: { id: "asc" },
    take: 1,
    select: { id: true },
  });
  if (tables.length < 2 || products.length < 1) {
    throw new Error(
      "Fixture DB missing baseline tables/products. Run `npx tsx prisma/seed.ts`.",
    );
  }
  firstTableId = tables[0].id;
  secondTableId = tables[1].id;
  firstProductId = products[0].id;
}

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

async function openSession(tableId: number) {
  const session = await prisma.$transaction(async (tx) => {
    const s = await tx.tableSession.create({
      data: { table_id: tableId, status: TableSessionStatus.open },
    });
    await projection.onSessionOpened(tableId, s.id, tx);
    return s;
  });
  return session;
}

async function resetProductStock(productId: number, stock: number) {
  await prisma.product.update({
    where: { id: productId },
    data: { stock, is_active: true },
  });
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
});

describe("Phase C · Case 1 · create → accept → stock decrement → active order", () => {
  it("walks the happy path end-to-end", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);

    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 3 }],
    });
    expect(req.status).toBe(OrderRequestStatus.pending);

    const table1 = await prisma.table.findUniqueOrThrow({ where: { id: firstTableId } });
    expect(table1.pending_request_count).toBe(1);
    expect(table1.active_order_count).toBe(0);

    const stockAfterCreate = await prisma.product.findUniqueOrThrow({
      where: { id: firstProductId },
    });
    expect(stockAfterCreate.stock).toBe(10);

    const accepted = await orderRequests.accept(req.id);
    expect(accepted.status).toBe(OrderRequestStatus.accepted);

    const stockAfterAccept = await prisma.product.findUniqueOrThrow({
      where: { id: firstProductId },
    });
    expect(stockAfterAccept.stock).toBe(7);

    const table2 = await prisma.table.findUniqueOrThrow({ where: { id: firstTableId } });
    expect(table2.pending_request_count).toBe(0);
    expect(table2.active_order_count).toBe(1);

    const order = await prisma.order.findFirstOrThrow({
      where: { order_request_id: req.id },
    });
    expect(order.status).toBe(OrderStatus.accepted);
  });
});

describe("Phase C · Case 2 · reject → no order → no stock change", () => {
  it("rejects without creating an order and without touching stock", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 2 }],
    });

    await orderRequests.reject(req.id, "test reason");

    const stock = await prisma.product.findUniqueOrThrow({ where: { id: firstProductId } });
    expect(stock.stock).toBe(10);

    const orders = await prisma.order.count();
    expect(orders).toBe(0);

    const table = await prisma.table.findUniqueOrThrow({ where: { id: firstTableId } });
    expect(table.pending_request_count).toBe(0);
    expect(table.active_order_count).toBe(0);

    const fresh = await prisma.orderRequest.findUniqueOrThrow({
      where: { id: req.id },
    });
    expect(fresh.status).toBe(OrderRequestStatus.rejected);
    expect(fresh.rejection_reason).toBe("test reason");
  });
});

describe("Phase C · Case 3 · accepted → preparing → ready → delivered creates consumption", () => {
  it("runs the full lifecycle and reflects consumption on Table.total_consumption", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);

    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 2 }],
    });
    const accepted = await orderRequests.accept(req.id);
    const order = accepted.order!;

    await orders.updateStatus(order.id, OrderStatus.preparing);
    await orders.updateStatus(order.id, OrderStatus.ready);
    await orders.updateStatus(order.id, OrderStatus.delivered);

    const consumptions = await prisma.consumption.findMany({
      where: { table_session_id: session.id },
    });
    expect(consumptions).toHaveLength(1);
    const c = consumptions[0];
    expect(Number(c.unit_amount)).toBeGreaterThan(0);
    expect(Number(c.amount)).toBeCloseTo(Number(c.unit_amount) * 2);

    const freshSession = await prisma.tableSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(Number(freshSession.total_consumption)).toBeCloseTo(
      Number(c.amount),
    );

    const table = await prisma.table.findUniqueOrThrow({ where: { id: firstTableId } });
    expect(Number(table.total_consumption)).toBeCloseTo(Number(c.amount));
    expect(table.active_order_count).toBe(0);
  });
});

describe("Phase C · Case 4 · cancel accepted order restores stock and creates no consumption", () => {
  it("restores stock on cancel and never emits Consumption", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);

    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 4 }],
    });
    const accepted = await orderRequests.accept(req.id);
    const orderId = accepted.order!.id;

    const stockAfterAccept = await prisma.product.findUniqueOrThrow({
      where: { id: firstProductId },
    });
    expect(stockAfterAccept.stock).toBe(6);

    await orders.updateStatus(orderId, OrderStatus.cancelled);

    const stockAfterCancel = await prisma.product.findUniqueOrThrow({
      where: { id: firstProductId },
    });
    expect(stockAfterCancel.stock).toBe(10);

    const consumptions = await prisma.consumption.count();
    expect(consumptions).toBe(0);

    const table = await prisma.table.findUniqueOrThrow({ where: { id: firstTableId } });
    expect(table.active_order_count).toBe(0);
    expect(Number(table.total_consumption)).toBe(0);
  });

  it("rejects invalid transitions (e.g. delivered → cancelled)", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 1 }],
    });
    const accepted = await orderRequests.accept(req.id);
    const orderId = accepted.order!.id;
    await orders.updateStatus(orderId, OrderStatus.preparing);
    await orders.updateStatus(orderId, OrderStatus.ready);
    await orders.updateStatus(orderId, OrderStatus.delivered);

    await expect(
      orders.updateStatus(orderId, OrderStatus.cancelled),
    ).rejects.toThrow(/Invalid transition/);
  });
});

describe("Phase C · Case 5 · concurrent accept of same OrderRequest", () => {
  it("only one succeeds; stock is decremented exactly once", async () => {
    await resetProductStock(firstProductId, 5);
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 3 }],
    });

    const results = await Promise.allSettled([
      orderRequests.accept(req.id),
      orderRequests.accept(req.id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const stock = await prisma.product.findUniqueOrThrow({ where: { id: firstProductId } });
    expect(stock.stock).toBe(2);

    const orderCount = await prisma.order.count({
      where: { order_request_id: req.id },
    });
    expect(orderCount).toBe(1);

    const table = await prisma.table.findUniqueOrThrow({ where: { id: firstTableId } });
    expect(table.active_order_count).toBe(1);
    expect(table.pending_request_count).toBe(0);
  });

  it("two requests competing for scarce stock: one accepts, one fails cleanly", async () => {
    await resetProductStock(firstProductId, 3);
    const session1 = await openSession(firstTableId);
    const session2 = await openSession(secondTableId);

    const req1 = await orderRequests.create({
      table_session_id: session1.id,
      items: [{ product_id: firstProductId, quantity: 3 }],
    });
    const req2 = await orderRequests.create({
      table_session_id: session2.id,
      items: [{ product_id: firstProductId, quantity: 3 }],
    });

    const results = await Promise.allSettled([
      orderRequests.accept(req1.id),
      orderRequests.accept(req2.id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const stock = await prisma.product.findUniqueOrThrow({ where: { id: firstProductId } });
    expect(stock.stock).toBe(0);

    const acceptedRequests = await prisma.orderRequest.count({
      where: { status: OrderRequestStatus.accepted },
    });
    expect(acceptedRequests).toBe(1);

    const orderCount = await prisma.order.count();
    expect(orderCount).toBe(1);
  });
});
