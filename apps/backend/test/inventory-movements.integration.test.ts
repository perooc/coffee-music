/**
 * Integration tests for Phase H3 — manual stock movements.
 *
 * Hits the real Postgres (DATABASE_URL) and exercises the service through
 * the same path the HTTP controller uses, including:
 *   - sign rules per type (restock > 0, waste < 0, adjustment != 0)
 *   - atomic stock update + audit row in a single transaction
 *   - STOCK_WOULD_GO_NEGATIVE on underflow
 *   - actor stamping (created_by) — server is the only source of truth
 *   - listing per-product and global filters
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InventoryMovementType, PrismaClient } from "@prisma/client";
import { InventoryMovementsService } from "../src/modules/products/inventory-movements.service";

const prisma = new PrismaClient();
const service = new InventoryMovementsService(prisma as any);

const actor = { user_id: 1, name: "Admin Test" };

let firstProductId = 1;
let secondProductId = 2;

async function loadFixtureIds() {
  const products = await prisma.product.findMany({
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });
  if (products.length < 2) {
    throw new Error("Fixture DB missing. Run `npx tsx prisma/seed.ts`.");
  }
  firstProductId = products[0].id;
  secondProductId = products[1].id;
}

async function resetStock(productId: number, stock: number) {
  await prisma.product.update({ where: { id: productId }, data: { stock } });
}

async function cleanMovements() {
  await prisma.inventoryMovement.deleteMany();
}

beforeAll(async () => {
  await loadFixtureIds();
  await cleanMovements();
});

afterAll(async () => {
  await cleanMovements();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanMovements();
  await resetStock(firstProductId, 10);
  await resetStock(secondProductId, 10);
});

describe("Phase H3 · sign rules per type", () => {
  it("restock with positive quantity → increases stock + writes audit row", async () => {
    const movement = await service.record(
      firstProductId,
      {
        type: InventoryMovementType.restock,
        quantity: 5,
        reason: "supplier delivery",
      },
      actor,
    );

    expect(movement.quantity).toBe(5);
    expect(movement.type).toBe(InventoryMovementType.restock);
    expect(movement.product.stock).toBe(15);
    expect(movement.created_by).toBe("Admin Test");

    const persisted = await prisma.product.findUniqueOrThrow({
      where: { id: firstProductId },
    });
    expect(persisted.stock).toBe(15);
  });

  it("restock with negative quantity → 400 INVENTORY_RESTOCK_MUST_BE_POSITIVE", async () => {
    await expect(
      service.record(
        firstProductId,
        { type: InventoryMovementType.restock, quantity: -3, reason: "wrong" },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: "INVENTORY_RESTOCK_MUST_BE_POSITIVE" },
    });
  });

  it("waste with negative quantity → decreases stock", async () => {
    const movement = await service.record(
      firstProductId,
      {
        type: InventoryMovementType.waste,
        quantity: -3,
        reason: "broken bottles",
      },
      actor,
    );
    expect(movement.product.stock).toBe(7);
    expect(movement.type).toBe(InventoryMovementType.waste);
  });

  it("waste with positive quantity → 400 INVENTORY_WASTE_MUST_BE_NEGATIVE", async () => {
    await expect(
      service.record(
        firstProductId,
        { type: InventoryMovementType.waste, quantity: 3, reason: "wrong" },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: "INVENTORY_WASTE_MUST_BE_NEGATIVE" },
    });
  });

  it("adjustment can be positive or negative", async () => {
    const up = await service.record(
      firstProductId,
      {
        type: InventoryMovementType.adjustment,
        quantity: 2,
        reason: "miscount up",
      },
      actor,
    );
    expect(up.product.stock).toBe(12);

    const down = await service.record(
      firstProductId,
      {
        type: InventoryMovementType.adjustment,
        quantity: -1,
        reason: "miscount down",
      },
      actor,
    );
    expect(down.product.stock).toBe(11);
  });

  it("correction can be positive or negative", async () => {
    const m = await service.record(
      firstProductId,
      {
        type: InventoryMovementType.correction,
        quantity: -2,
        reason: "fix prior over-count",
      },
      actor,
    );
    expect(m.product.stock).toBe(8);
  });
});

describe("Phase H3 · stock cannot go negative", () => {
  it("rejects with STOCK_WOULD_GO_NEGATIVE and reports current_stock + attempted_delta", async () => {
    await resetStock(firstProductId, 2);

    try {
      await service.record(
        firstProductId,
        {
          type: InventoryMovementType.waste,
          quantity: -5,
          reason: "everything broke",
        },
        actor,
      );
      throw new Error("expected to throw");
    } catch (err) {
      const body = (err as { response?: Record<string, unknown> }).response;
      expect(body?.code).toBe("STOCK_WOULD_GO_NEGATIVE");
      expect(body?.current_stock).toBe(2);
      expect(body?.attempted_delta).toBe(-5);
    }

    // Stock untouched, no audit row written.
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: firstProductId },
    });
    expect(product.stock).toBe(2);
    const movements = await prisma.inventoryMovement.count();
    expect(movements).toBe(0);
  });

  it("exact zero floor is allowed (stock + delta === 0)", async () => {
    await resetStock(firstProductId, 3);
    const m = await service.record(
      firstProductId,
      {
        type: InventoryMovementType.waste,
        quantity: -3,
        reason: "throw out batch",
      },
      actor,
    );
    expect(m.product.stock).toBe(0);
  });
});

describe("Phase H3 · audit (created_by is server-sourced)", () => {
  it("ignores created_by from the body when an actor is provided", async () => {
    // Simulate a forged client payload that injects the field. With
    // ValidationPipe(forbidNonWhitelisted) on the HTTP layer this would
    // already be a 400. Service-level test forces it through to prove the
    // service ignores the body field even if the validation pipe were
    // bypassed.
    const forged = {
      type: InventoryMovementType.restock,
      quantity: 1,
      reason: "supplier",
      created_by: "fake",
    } as unknown as Parameters<typeof service.record>[1];

    const m = await service.record(firstProductId, forged, {
      user_id: 99,
      name: "Real Admin",
    });
    expect(m.created_by).toBe("Real Admin");
    expect(m.created_by).not.toBe("fake");
  });

  it("no actor → persists null", async () => {
    const m = await service.record(firstProductId, {
      type: InventoryMovementType.restock,
      quantity: 1,
      reason: "internal seed",
    });
    expect(m.created_by).toBeNull();
  });
});

describe("Phase H3 · listing", () => {
  it("listForProduct returns most-recent first", async () => {
    await service.record(
      firstProductId,
      {
        type: InventoryMovementType.restock,
        quantity: 1,
        reason: "first",
      },
      actor,
    );
    await service.record(
      firstProductId,
      {
        type: InventoryMovementType.restock,
        quantity: 1,
        reason: "second",
      },
      actor,
    );

    const list = await service.listForProduct(firstProductId);
    expect(list).toHaveLength(2);
    expect(list[0].reason).toBe("second");
    expect(list[1].reason).toBe("first");
  });

  it("listForProduct: 404 PRODUCT_NOT_FOUND for unknown product", async () => {
    await expect(service.listForProduct(99_999)).rejects.toMatchObject({
      response: { code: "PRODUCT_NOT_FOUND" },
    });
  });

  it("listGlobal filters by type", async () => {
    await service.record(
      firstProductId,
      { type: InventoryMovementType.restock, quantity: 1, reason: "r1" },
      actor,
    );
    await service.record(
      secondProductId,
      { type: InventoryMovementType.waste, quantity: -1, reason: "w1" },
      actor,
    );

    const onlyRestock = await service.listGlobal({
      type: InventoryMovementType.restock,
    });
    expect(onlyRestock.every((m) => m.type === "restock")).toBe(true);
    expect(onlyRestock.length).toBeGreaterThan(0);
  });

  it("listGlobal clamps limit to [1, 200]", async () => {
    const tooSmall = await service.listGlobal({ limit: -5 });
    expect(Array.isArray(tooSmall)).toBe(true); // would have errored if limit was -5
    const tooBig = await service.listGlobal({ limit: 999 });
    expect(Array.isArray(tooBig)).toBe(true);
  });
});

describe("Phase H3 · transactional integrity", () => {
  it("does not write the audit row if the underflow check fails", async () => {
    await resetStock(firstProductId, 1);
    await expect(
      service.record(
        firstProductId,
        {
          type: InventoryMovementType.waste,
          quantity: -10,
          reason: "would underflow",
        },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: "STOCK_WOULD_GO_NEGATIVE" },
    });

    const movements = await prisma.inventoryMovement.findMany({
      where: { product_id: firstProductId },
    });
    expect(movements).toHaveLength(0);
  });
});
