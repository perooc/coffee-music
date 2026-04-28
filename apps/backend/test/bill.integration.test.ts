/**
 * Integration tests for Phase D: LiveBill + Consumption adjustments/refunds.
 *
 * These hit the real Postgres (from .env DATABASE_URL) and exercise the full
 * consumption ledger, including ajustes, descuentos, refunds, y políticas
 * de sesión (open/closing/closed).
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
import { AdjustmentKind } from "../src/modules/consumptions/dto/create-adjustment.dto";
import { OrderRequestsService } from "../src/modules/order-requests/order-requests.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { TableProjectionService } from "../src/modules/table-projection/table-projection.service";

const prisma = new PrismaClient();

/**
 * Resolve the first N table IDs and product IDs once for the whole suite.
 * Seed inserts are not guaranteed to use ids 1..N because Postgres sequences
 * do not reset on `deleteMany`. Tests therefore bind to whatever ids exist
 * right now rather than hard-coding.
 */
let firstTableId = 1;
let firstProductId = 1;
let secondProductId = 2;
async function loadFixtureIds() {
  const tables = await prisma.table.findMany({
    orderBy: { id: "asc" },
    take: 1,
    select: { id: true },
  });
  const products = await prisma.product.findMany({
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });
  if (tables.length < 1 || products.length < 2) {
    throw new Error(
      "Fixture DB missing baseline tables/products. Run `npx tsx prisma/seed.ts`.",
    );
  }
  firstTableId = tables[0].id;
  firstProductId = products[0].id;
  secondProductId = products[1].id;
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
  return prisma.$transaction(async (tx) => {
    const s = await tx.tableSession.create({
      data: { table_id: tableId, status: TableSessionStatus.open },
    });
    await projection.onSessionOpened(tableId, s.id, tx);
    return s;
  });
}

async function closeSession(sessionId: number, tableId: number) {
  return prisma.$transaction(async (tx) => {
    const s = await tx.tableSession.update({
      where: { id: sessionId },
      data: { status: TableSessionStatus.closed, closed_at: new Date() },
    });
    await projection.onSessionClosed(tableId, tx);
    return s;
  });
}

async function setClosing(sessionId: number) {
  return prisma.tableSession.update({
    where: { id: sessionId },
    data: { status: TableSessionStatus.closing },
  });
}

async function resetProductStock(productId: number, stock: number) {
  await prisma.product.update({
    where: { id: productId },
    data: { stock, is_active: true },
  });
}

async function deliver(orderId: number) {
  await orders.updateStatus(orderId, OrderStatus.preparing);
  await orders.updateStatus(orderId, OrderStatus.ready);
  await orders.updateStatus(orderId, OrderStatus.delivered);
}

async function placeAndDeliver(
  sessionId: number,
  productId: number,
  quantity: number,
) {
  const req = await orderRequests.create({
    table_session_id: sessionId,
    items: [{ product_id: productId, quantity }],
  });
  const accepted = await orderRequests.accept(req.id);
  await deliver(accepted.order!.id);
  return accepted.order!.id;
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

describe("Phase D · Case 1 · delivered order shows in bill", () => {
  it("single delivery: subtotal = order amount, Table consistent", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);
    await placeAndDeliver(session.id, firstProductId, 2);

    const bill = await consumptions.getBill(session.id);
    expect(bill.items).toHaveLength(1);
    expect(bill.items[0].type).toBe(ConsumptionType.product);
    expect(bill.summary.item_count).toBe(1);
    expect(bill.summary.subtotal).toBeGreaterThan(0);
    expect(bill.summary.discounts_total).toBe(0);
    expect(bill.summary.adjustments_total).toBe(0);
    expect(bill.summary.total).toBe(bill.summary.subtotal);

    const session2 = await prisma.tableSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    const table = await prisma.table.findUniqueOrThrow({ where: { id: firstTableId } });
    expect(Number(session2.total_consumption)).toBe(bill.summary.total);
    expect(Number(table.total_consumption)).toBe(bill.summary.total);
  });
});

describe("Phase D · Case 2 · two deliveries accumulate chronologically", () => {
  it("accumulates subtotal and preserves order by created_at", async () => {
    await resetProductStock(firstProductId, 10);
    await resetProductStock(secondProductId, 10);
    const session = await openSession(firstTableId);

    await placeAndDeliver(session.id, firstProductId, 1);
    await placeAndDeliver(session.id, secondProductId, 2);

    const bill = await consumptions.getBill(session.id);
    expect(bill.items).toHaveLength(2);
    expect(bill.items[0].created_at.getTime()).toBeLessThanOrEqual(
      bill.items[1].created_at.getTime(),
    );
    const manual =
      Number(bill.items[0].amount) + Number(bill.items[1].amount);
    expect(bill.summary.subtotal).toBeCloseTo(manual);
    expect(bill.summary.total).toBeCloseTo(manual);
  });
});

describe("Phase D · Case 3 · positive adjustment", () => {
  it("increases bill, session, and Table.total_consumption", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);
    await placeAndDeliver(session.id, firstProductId, 1);

    const before = await consumptions.getBill(session.id);

    await consumptions.createAdjustment(session.id, {
      type: AdjustmentKind.adjustment,
      amount: 2500,
      reason: "service charge",
    });

    const after = await consumptions.getBill(session.id);
    expect(after.summary.subtotal).toBe(before.summary.subtotal);
    expect(after.summary.adjustments_total).toBe(2500);
    expect(after.summary.total).toBeCloseTo(before.summary.total + 2500);
    expect(after.items).toHaveLength(before.items.length + 1);

    const freshSession = await prisma.tableSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    const freshTable = await prisma.table.findUniqueOrThrow({
      where: { id: firstTableId },
    });
    expect(Number(freshSession.total_consumption)).toBeCloseTo(
      after.summary.total,
    );
    expect(Number(freshTable.total_consumption)).toBeCloseTo(
      after.summary.total,
    );
  });
});

describe("Phase D · Case 4 · negative discount", () => {
  it("decreases bill + projections; fairness input stays consistent", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);
    await placeAndDeliver(session.id, firstProductId, 1);
    const before = await consumptions.getBill(session.id);

    await consumptions.createAdjustment(session.id, {
      type: AdjustmentKind.discount,
      amount: 1000, // server forces negative
      reason: "loyalty discount",
    });

    const after = await consumptions.getBill(session.id);
    expect(after.summary.subtotal).toBe(before.summary.subtotal);
    expect(after.summary.discounts_total).toBe(-1000);
    expect(after.summary.total).toBeCloseTo(before.summary.total - 1000);

    const freshTable = await prisma.table.findUniqueOrThrow({
      where: { id: firstTableId },
    });
    expect(Number(freshTable.total_consumption)).toBeCloseTo(
      after.summary.total,
    );
    // Fairness reads Table.total_consumption — must be non-negative after a discount
    // that is smaller than the existing subtotal.
    expect(Number(freshTable.total_consumption)).toBeGreaterThanOrEqual(0);
  });

  it("forces sign: discount with positive amount stored as negative", async () => {
    const session = await openSession(firstTableId);
    const adj = await consumptions.createAdjustment(session.id, {
      type: AdjustmentKind.discount,
      amount: 500,
      reason: "happy hour",
    });
    expect(Number(adj.amount)).toBe(-500);
  });
});

describe("Phase D · Case 5 · session lifecycle policy", () => {
  it("closing sessions still accept adjustments", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);
    await placeAndDeliver(session.id, firstProductId, 1);
    await setClosing(session.id);

    const adj = await consumptions.createAdjustment(session.id, {
      type: AdjustmentKind.adjustment,
      amount: 200,
      reason: "last-minute fix",
    });
    expect(adj.id).toBeTypeOf("number");
  });

  it("closed session: GET bill still works", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);
    await placeAndDeliver(session.id, firstProductId, 1);
    await closeSession(session.id, firstTableId);

    const bill = await consumptions.getBill(session.id);
    expect(bill.status).toBe(TableSessionStatus.closed);
    expect(bill.items.length).toBeGreaterThan(0);
  });

  it("closed session: POST adjustment is rejected", async () => {
    const session = await openSession(firstTableId);
    await closeSession(session.id, firstTableId);
    await expect(
      consumptions.createAdjustment(session.id, {
        type: AdjustmentKind.adjustment,
        amount: 100,
        reason: "post-close fix",
      }),
    ).rejects.toThrow(/closed/i);
  });
});

describe("Phase D · refund / ledger immutability", () => {
  it("refund creates negative consumption and marks original reversed", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);
    await placeAndDeliver(session.id, firstProductId, 1);
    const originalBill = await consumptions.getBill(session.id);
    const original = originalBill.items[0];

    const refund = await consumptions.refundConsumption(original.id, {
      reason: "quality complaint",
    });
    expect(refund.type).toBe(ConsumptionType.refund);
    expect(Number(refund.amount)).toBe(-original.amount);
    expect(refund.reverses_id).toBe(original.id);

    const afterBill = await consumptions.getBill(session.id);
    expect(afterBill.summary.subtotal).toBe(originalBill.summary.subtotal);
    expect(afterBill.summary.adjustments_total).toBe(-original.amount);
    expect(afterBill.summary.total).toBe(0);

    const freshOriginal = await prisma.consumption.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(freshOriginal.reversed_at).not.toBeNull();
  });

  it("double refund is blocked", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);
    await placeAndDeliver(session.id, firstProductId, 1);
    const bill = await consumptions.getBill(session.id);
    const original = bill.items[0];
    await consumptions.refundConsumption(original.id, { reason: "r1" });
    await expect(
      consumptions.refundConsumption(original.id, { reason: "r2" }),
    ).rejects.toThrow(/already/i);
  });

  it("refund of a refund is blocked", async () => {
    await resetProductStock(firstProductId, 10);
    const session = await openSession(firstTableId);
    await placeAndDeliver(session.id, firstProductId, 1);
    const bill = await consumptions.getBill(session.id);
    const original = bill.items[0];
    const refund = await consumptions.refundConsumption(original.id, {
      reason: "r1",
    });
    await expect(
      consumptions.refundConsumption(refund.id, { reason: "r2" }),
    ).rejects.toThrow(/refund/i);
  });
});
