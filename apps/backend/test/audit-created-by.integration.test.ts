/**
 * Integration test for Phase G6: server is the single source of truth for
 * `created_by` on the consumption ledger.
 *
 * If a request arrives with `created_by: "fake"` in the body but the token
 * identifies the user as "Admin Test", the ledger MUST persist "Admin Test"
 * and never the body value. This prevents the frontend (or any intermediary)
 * from forging audit records.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ConsumptionType,
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

let firstTableId = 1;
let firstProductId = 1;
async function loadFixtureIds() {
  const table = await prisma.table.findFirst({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  const product = await prisma.product.findFirst({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!table || !product) {
    throw new Error("Fixture DB missing. Run `npx tsx prisma/seed.ts`.");
  }
  firstTableId = table.id;
  firstProductId = product.id;
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
  await prisma.product.update({
    where: { id: firstProductId },
    data: { stock: 10, is_active: true },
  });
  const req = await orderRequests.create({
    table_session_id: sessionId,
    items: [{ product_id: firstProductId, quantity: 1 }],
  });
  const accepted = await orderRequests.accept(req.id);
  const orderId = accepted.order!.id;
  await orders.updateStatus(orderId, "preparing");
  await orders.updateStatus(orderId, "ready");
  await orders.updateStatus(orderId, "delivered");
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
});

describe("Phase G6 · created_by is server-sourced", () => {
  it("adjustment: ignores body created_by when an actor is provided", async () => {
    const session = await openSession(firstTableId);

    const actor = { user_id: 42, name: "Admin Test" };

    // Simulate a forged client payload that injects an extra field. In HTTP
    // it would be rejected by ValidationPipe(forbidNonWhitelisted) before
    // reaching the service. Here we force it through to prove the service
    // ignores it even if the validation layer were bypassed.
    const forgedDto = {
      type: AdjustmentKind.adjustment,
      amount: 500,
      reason: "service charge",
      created_by: "fake",
    } as unknown as Parameters<typeof consumptions.createAdjustment>[1];

    const created = await consumptions.createAdjustment(
      session.id,
      forgedDto,
      actor,
    );

    expect(created.created_by).toBe("Admin Test");

    const persisted = await prisma.consumption.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(persisted.created_by).toBe("Admin Test");
    expect(persisted.created_by).not.toBe("fake");
  });

  it("discount: ignores body created_by when an actor is provided", async () => {
    const session = await openSession(firstTableId);

    const actor = { user_id: 1, name: "Staff Cashier" };

    const forgedDto = {
      type: AdjustmentKind.discount,
      amount: 200,
      reason: "loyalty",
      created_by: "someone-else",
    } as unknown as Parameters<typeof consumptions.createAdjustment>[1];

    const created = await consumptions.createAdjustment(
      session.id,
      forgedDto,
      actor,
    );

    expect(created.type).toBe(ConsumptionType.discount);
    expect(created.created_by).toBe("Staff Cashier");
  });

  it("refund: ignores body created_by when an actor is provided", async () => {
    const session = await openSession(firstTableId);
    await placeAndDeliver(session.id);

    const bill = await consumptions.getBill(session.id);
    const productRow = bill.items[0];

    const actor = { user_id: 99, name: "Admin Real" };

    const forgedDto = {
      reason: "quality complaint",
      created_by: "imposter",
    } as unknown as Parameters<typeof consumptions.refundConsumption>[1];

    const refund = await consumptions.refundConsumption(
      productRow.id,
      forgedDto,
      actor,
    );

    expect(refund.created_by).toBe("Admin Real");

    const persisted = await prisma.consumption.findUniqueOrThrow({
      where: { id: refund.id },
    });
    expect(persisted.created_by).toBe("Admin Real");
    expect(persisted.created_by).not.toBe("imposter");
  });

  it("no actor: persists null (server is the only audit source)", async () => {
    // This path is only reachable when the service is called without HTTP
    // auth — seeds, scripts, internal admin tasks. The DTO no longer carries
    // `created_by` (G7), so callers can never pretend to be a user. We
    // record null which is the honest answer: no human was on the line.
    const session = await openSession(firstTableId);

    const created = await consumptions.createAdjustment(session.id, {
      type: AdjustmentKind.adjustment,
      amount: 100,
      reason: "manual seed",
    });

    expect(created.created_by).toBeNull();
  });
});
