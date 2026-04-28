/**
 * Phase H6 — operational QA for inventory.
 *
 * This file ONLY adds cases that are not already covered by:
 *   - inventory-movements.integration.test.ts (sign rules, atomic stock
 *     update, audit, listing)
 *   - sales-insights.integration.test.ts (delivered/cancelled/refund flow)
 *   - orders-split.integration.test.ts (accept lowers stock; cancel restores)
 *
 * Specifically locks the boundary between the inventory ledger and the
 * sales ledger:
 *   - inactive / out-of-stock products cannot be ordered
 *   - public catalog hides inactive products
 *   - InventoryMovement (restock/adjustment) NEVER produces a sale
 *   - is_low_stock / is_out_of_stock flags are honest
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  InventoryMovementType,
  PrismaClient,
  TableSessionStatus,
  TableStatus,
} from "@prisma/client";
import { ConsumptionsService } from "../src/modules/consumptions/consumptions.service";
import { InventoryMovementsService } from "../src/modules/products/inventory-movements.service";
import { OrderRequestsService } from "../src/modules/order-requests/order-requests.service";
import { ProductsService } from "../src/modules/products/products.service";
import { SalesInsightsService } from "../src/modules/sales-insights/sales-insights.service";
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
const productsService = new ProductsService(prisma as any);
const inventory = new InventoryMovementsService(prisma as any);
const insights = new SalesInsightsService(prisma as any);

const actor = { user_id: 1, name: "Admin Test" };

let firstTableId = 1;
let firstProductId = 1;
let secondProductId = 2;

async function loadFixtureIds() {
  const [t] = await prisma.table.findMany({
    orderBy: { id: "asc" },
    take: 1,
    select: { id: true },
  });
  const products = await prisma.product.findMany({
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });
  if (!t || products.length < 2) {
    throw new Error("Fixture DB missing. Run `npx tsx prisma/seed.ts`.");
  }
  firstTableId = t.id;
  firstProductId = products[0].id;
  secondProductId = products[1].id;
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

async function resetProduct(
  productId: number,
  partial: {
    stock?: number;
    is_active?: boolean;
    low_stock_threshold?: number;
  },
) {
  await prisma.product.update({
    where: { id: productId },
    data: {
      stock: partial.stock,
      is_active: partial.is_active,
      low_stock_threshold: partial.low_stock_threshold,
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
  await resetProduct(firstProductId, { stock: 10, is_active: true, low_stock_threshold: 0 });
  await resetProduct(secondProductId, { stock: 10, is_active: true, low_stock_threshold: 0 });
});

// ─── Public catalog hides inactive products ──────────────────────────────

describe("Phase H6 · public catalog excludes inactive products", () => {
  it("findAllForCustomers does not return inactive rows", async () => {
    await resetProduct(firstProductId, { is_active: false });
    const list = await productsService.findAllForCustomers();
    expect(list.find((p) => p.id === firstProductId)).toBeUndefined();
    expect(list.find((p) => p.id === secondProductId)).toBeDefined();
  });
});

// ─── Inactive / out-of-stock products cannot be ordered ─────────────────

describe("Phase H6 · OrderRequest blocks invalid catalog states", () => {
  it("inactive product → 400 PRODUCT_INACTIVE", async () => {
    const session = await openSession(firstTableId);
    await resetProduct(firstProductId, { is_active: false });

    await expect(
      orderRequests.create({
        table_session_id: session.id,
        items: [{ product_id: firstProductId, quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      response: { code: "PRODUCT_INACTIVE" },
    });
  });

  it("out-of-stock product → 400 STOCK_INSUFFICIENT", async () => {
    const session = await openSession(firstTableId);
    await resetProduct(firstProductId, { stock: 0 });

    await expect(
      orderRequests.create({
        table_session_id: session.id,
        items: [{ product_id: firstProductId, quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      response: { code: "STOCK_INSUFFICIENT" },
    });
  });

  it("requesting more units than stock → 400 STOCK_INSUFFICIENT", async () => {
    const session = await openSession(firstTableId);
    await resetProduct(firstProductId, { stock: 2 });

    await expect(
      orderRequests.create({
        table_session_id: session.id,
        items: [{ product_id: firstProductId, quantity: 5 }],
      }),
    ).rejects.toMatchObject({
      response: { code: "STOCK_INSUFFICIENT" },
    });
  });
});

// ─── InventoryMovement vs sales ledger ──────────────────────────────────

describe("Phase H6 · stock movements never appear as sales", () => {
  it("restock raises stock but produces no Consumption", async () => {
    await resetProduct(firstProductId, { stock: 5 });
    await inventory.record(
      firstProductId,
      {
        type: InventoryMovementType.restock,
        quantity: 20,
        reason: "supplier delivery",
      },
      actor,
    );

    const stock = await prisma.product.findUniqueOrThrow({
      where: { id: firstProductId },
    });
    expect(stock.stock).toBe(25);

    // No Consumption row created for this movement.
    const consumptionsForProduct = await prisma.consumption.findMany({
      where: { product_id: firstProductId },
    });
    expect(consumptionsForProduct).toHaveLength(0);

    // Insights show zero sales for this product.
    const r = await insights.getInsights({});
    expect(r.summary.total_units).toBe(0);
    expect(r.top_selling).toHaveLength(0);
  });

  it("adjustment changes stock but does not appear in sales totals", async () => {
    await resetProduct(firstProductId, { stock: 10 });
    await inventory.record(
      firstProductId,
      {
        type: InventoryMovementType.adjustment,
        quantity: -3,
        reason: "miscount",
      },
      actor,
    );
    await inventory.record(
      firstProductId,
      {
        type: InventoryMovementType.adjustment,
        quantity: 1,
        reason: "found one",
      },
      actor,
    );

    const stock = await prisma.product.findUniqueOrThrow({
      where: { id: firstProductId },
    });
    expect(stock.stock).toBe(8);

    const r = await insights.getInsights({});
    expect(r.summary.total_units).toBe(0);
    expect(r.summary.total_revenue).toBe(0);

    // Audit rows ARE present in the inventory ledger.
    const movements = await prisma.inventoryMovement.findMany({
      where: { product_id: firstProductId },
    });
    expect(movements).toHaveLength(2);
  });

  it("waste lowers stock but does not appear in sales", async () => {
    await resetProduct(firstProductId, { stock: 10 });
    await inventory.record(
      firstProductId,
      {
        type: InventoryMovementType.waste,
        quantity: -2,
        reason: "broken bottles",
      },
      actor,
    );

    const r = await insights.getInsights({});
    expect(r.summary.total_units).toBe(0);

    const stock = await prisma.product.findUniqueOrThrow({
      where: { id: firstProductId },
    });
    expect(stock.stock).toBe(8);
  });
});

// ─── Stock state flags ──────────────────────────────────────────────────

describe("Phase H6 · is_low_stock / is_out_of_stock serialization", () => {
  it("stock above threshold → neither flag", async () => {
    await resetProduct(firstProductId, {
      stock: 10,
      low_stock_threshold: 3,
    });
    const p = await productsService.findOneForAdmin(firstProductId);
    expect(p.is_out_of_stock).toBe(false);
    expect(p.is_low_stock).toBe(false);
  });

  it("stock equal to threshold → is_low_stock=true", async () => {
    await resetProduct(firstProductId, {
      stock: 3,
      low_stock_threshold: 3,
    });
    const p = await productsService.findOneForAdmin(firstProductId);
    expect(p.is_low_stock).toBe(true);
    expect(p.is_out_of_stock).toBe(false);
  });

  it("stock below threshold → is_low_stock=true", async () => {
    await resetProduct(firstProductId, {
      stock: 1,
      low_stock_threshold: 3,
    });
    const p = await productsService.findOneForAdmin(firstProductId);
    expect(p.is_low_stock).toBe(true);
    expect(p.is_out_of_stock).toBe(false);
  });

  it("stock 0 → is_out_of_stock=true, is_low_stock=false", async () => {
    await resetProduct(firstProductId, {
      stock: 0,
      low_stock_threshold: 3,
    });
    const p = await productsService.findOneForAdmin(firstProductId);
    expect(p.is_out_of_stock).toBe(true);
    expect(p.is_low_stock).toBe(false);
  });

  it("threshold 0 (disabled) → is_low_stock always false even at low stock", async () => {
    await resetProduct(firstProductId, {
      stock: 1,
      low_stock_threshold: 0,
    });
    const p = await productsService.findOneForAdmin(firstProductId);
    expect(p.is_low_stock).toBe(false);
    expect(p.is_out_of_stock).toBe(false);
  });
});
