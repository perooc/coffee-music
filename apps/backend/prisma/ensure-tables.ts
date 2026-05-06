/**
 * Idempotent: makes sure every table number listed in TARGET exists in the
 * DB. Safe to run against production — does NOT touch tables that already
 * exist (no sessions are wiped, no QR codes are rotated).
 *
 * Usage:
 *   DATABASE_URL=... npx tsx prisma/ensure-tables.ts
 *
 * Tweak TARGET below when the bar grows.
 */
import { PrismaClient, TableStatus } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET = [1, 2, 3, 4, 5, 6];

async function main() {
  const existing = await prisma.table.findMany({
    where: { number: { in: TARGET } },
    select: { number: true },
  });
  const existingSet = new Set(existing.map((t) => t.number));

  const missing = TARGET.filter((n) => !existingSet.has(n));
  if (missing.length === 0) {
    console.log(
      `[ensure-tables] All ${TARGET.length} target tables already exist. No-op.`,
    );
    return;
  }

  console.log(
    `[ensure-tables] Creating ${missing.length} missing table(s): ${missing.join(", ")}`,
  );

  await prisma.table.createMany({
    data: missing.map((n) => ({
      number: n,
      qr_code: `mesa-${n}`,
      status: TableStatus.available,
    })),
    skipDuplicates: true,
  });

  console.log("[ensure-tables] Done.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("[ensure-tables] Failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
