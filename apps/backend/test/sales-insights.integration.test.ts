/**
 * Phase H5 — sales insights integration tests.
 *
 * Hits the real Postgres and goes through the full flow (request → accept →
 * deliver) so the Consumption rows the service reads are produced the same
 * way they are in production. Locks the contract:
 *
 *   - delivered orders show up in top_selling / revenue
 *   - cancelled orders never inflate sales (no Consumption row in the first
 *     place)
 *   - refunded products are excluded from totals
 *   - products with stock and zero sales appear in low_rotation
 *   - low_stock_high_demand cross is computed from the live thresholds
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ConsumptionType,
  OrderStatus,
  PrismaClient,
  TableSessionStatus,
  TableStatus,
} from "@prisma/client";
import { ConsumptionsService } from "../src/modules/consumptions/consumptions.service";
import { OrderRequestsService } from "../src/modules/order-requests/order-requests.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { TableProjectionService } from "../src/modules/table-projection/table-projection.service";
import { SalesInsightsService } from "../src/modules/sales-insights/sales-insights.service";

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
const insights = new SalesInsightsService(prisma as any);

let firstTableId = 1;
let firstProductId = 1;
let secondProductId = 2;
let thirdProductId = 3;

async function loadFixtureIds() {
  const tables = await prisma.table.findMany({
    orderBy: { id: "asc" },
    take: 1,
    select: { id: true },
  });
  const products = await prisma.product.findMany({
    orderBy: { id: "asc" },
    take: 3,
    select: { id: true },
  });
  if (!tables[0] || products.length < 3) {
    throw new Error("Fixture DB missing. Run `npx tsx prisma/seed.ts`.");
  }
  firstTableId = tables[0].id;
  firstProductId = products[0].id;
  secondProductId = products[1].id;
  thirdProductId = products[2].id;
}

async function cleanDb() {
  await prisma.consumption.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.orderRequest.deleteMany();
  await prisma.tableSession.deleteMany();
  await prisma.inventoryMovement.deleteMany();
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

async function resetProduct(productId: number, stock: number, threshold = 0) {
  await prisma.product.update({
    where: { id: productId },
    data: { stock, low_stock_threshold: threshold, is_active: true },
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

async function deliver(sessionId: number, productId: number, qty: number) {
  const req = await orderRequests.create({
    table_session_id: sessionId,
    items: [{ product_id: productId, quantity: qty }],
  });
  const accepted = await orderRequests.accept(req.id);
  const orderId = accepted.order!.id;
  await orders.updateStatus(orderId, OrderStatus.preparing);
  await orders.updateStatus(orderId, OrderStatus.ready);
  await orders.updateStatus(orderId, OrderStatus.delivered);
  return orderId;
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
  await resetProduct(firstProductId, 100, 0);
  await resetProduct(secondProductId, 100, 0);
  await resetProduct(thirdProductId, 100, 0);
});

describe("Phase H5 · top selling and revenue", () => {
  it("counts delivered units and revenue per product", async () => {
    const session = await openSession(firstTableId);
    await deliver(session.id, firstProductId, 3);
    await deliver(session.id, firstProductId, 2);
    await deliver(session.id, secondProductId, 1);

    const r = await insights.getInsights({});

    expect(r.summary.total_units).toBe(6);
    expect(r.summary.distinct_products_sold).toBe(2);

    const top = r.top_selling[0];
    expect(top.product_id).toBe(firstProductId);
    expect(top.units_sold).toBe(5);

    const second = r.top_selling[1];
    expect(second.product_id).toBe(secondProductId);
    expect(second.units_sold).toBe(1);
  });
});

describe("Phase H5 · cancelled orders are NOT counted", () => {
  it("an order cancelled before delivery never produces Consumption", async () => {
    const session = await openSession(firstTableId);
    const req = await orderRequests.create({
      table_session_id: session.id,
      items: [{ product_id: firstProductId, quantity: 5 }],
    });
    const accepted = await orderRequests.accept(req.id);
    await orders.updateStatus(accepted.order!.id, OrderStatus.cancelled);

    const r = await insights.getInsights({});
    expect(r.summary.total_units).toBe(0);
    expect(r.summary.distinct_products_sold).toBe(0);
  });
});

describe("Phase H5 · refunds remove the consumption from sales", () => {
  it("refunding a delivered product zeroes its sales counters", async () => {
    const session = await openSession(firstTableId);
    await deliver(session.id, firstProductId, 4);

    // Confirm it counted before refund.
    const before = await insights.getInsights({});
    expect(before.summary.total_units).toBe(4);

    const bill = await consumptions.getBill(session.id);
    const productRow = bill.items.find(
      (c) => c.type === ConsumptionType.product,
    );
    expect(productRow).toBeDefined();
    await consumptions.refundConsumption(productRow!.id, {
      reason: "quality complaint",
    });

    const after = await insights.getInsights({});
    expect(after.summary.total_units).toBe(0);
    expect(after.summary.distinct_products_sold).toBe(0);
  });
});

describe("Phase H5 · low_rotation = active product, stock>0, 0 sales in range", () => {
  it("includes products with stock that did NOT sell", async () => {
    const session = await openSession(firstTableId);
    await deliver(session.id, firstProductId, 1);

    const r = await insights.getInsights({});
    const lowRotIds = new Set(r.low_rotation.map((p) => p.product_id));
    expect(lowRotIds.has(firstProductId)).toBe(false); // it sold
    expect(lowRotIds.has(secondProductId)).toBe(true); // it didn't
    expect(lowRotIds.has(thirdProductId)).toBe(true);
  });

  it("excludes inactive products and products with stock 0", async () => {
    await prisma.product.update({
      where: { id: secondProductId },
      data: { is_active: false },
    });
    await prisma.product.update({
      where: { id: thirdProductId },
      data: { stock: 0 },
    });

    const r = await insights.getInsights({});
    const lowRotIds = new Set(r.low_rotation.map((p) => p.product_id));
    expect(lowRotIds.has(secondProductId)).toBe(false); // inactive
    expect(lowRotIds.has(thirdProductId)).toBe(false); // out of stock
  });
});

describe("Phase H5 · low_stock_high_demand cross", () => {
  it("flags top sellers whose stock is at or below their threshold", async () => {
    // Set up: firstProduct has high demand AND low stock relative to its
    // own threshold — should be flagged.
    await resetProduct(firstProductId, 2, 5);

    const session = await openSession(firstTableId);
    await deliver(session.id, firstProductId, 1); // stock 2 → 1 after sale

    const r = await insights.getInsights({});
    const flagged = r.low_stock_high_demand.find(
      (s) => s.product_id === firstProductId,
    );
    expect(flagged).toBeDefined();
    expect(flagged!.stock).toBe(1);
    expect(flagged!.low_stock_threshold).toBe(5);
    expect(flagged!.units_sold).toBe(1);
  });

  it("does not flag products with healthy stock", async () => {
    await resetProduct(firstProductId, 50, 5);
    const session = await openSession(firstTableId);
    await deliver(session.id, firstProductId, 1);

    const r = await insights.getInsights({});
    expect(
      r.low_stock_high_demand.find((s) => s.product_id === firstProductId),
    ).toBeUndefined();
  });
});

describe("Phase H5 · range and validation", () => {
  it("default range is today (1 day)", async () => {
    const r = await insights.getInsights({});
    expect(r.range.days).toBe(1);
  });

  it("days clamps to [1, 30]", async () => {
    const r1 = await insights.getInsights({ days: 0 });
    expect(r1.range.days).toBe(1);
    const r2 = await insights.getInsights({ days: 999 });
    expect(r2.range.days).toBe(30);
  });

  it("invalid `day` format → 400 SALES_INVALID_DAY", async () => {
    await expect(
      insights.getInsights({ day: "not-a-date" }),
    ).rejects.toMatchObject({ response: { code: "SALES_INVALID_DAY" } });
  });
});
