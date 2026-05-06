import { PrismaClient, TableStatus, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";

const prisma = new PrismaClient();

/**
 * Production safety: this seed wipes EVERY table in the schema. Running
 * it against the live cluster nukes products, sessions, the ledger —
 * irrecoverable without a Postgres restore. We refuse to proceed when
 * DATABASE_URL looks like a production hostname unless the operator
 * explicitly opts in with `I_KNOW_THIS_IS_PROD=true`.
 *
 * The hostname patterns below cover Railway / Render / Supabase / Neon
 * / Heroku — the most common managed Postgres providers. Add more as
 * needed; the cost of a false positive (rejecting a legitimate run) is
 * a 30-second restart, the cost of a false negative (silently nuking
 * prod) is hours of recovery.
 */
const PROD_HOST_PATTERNS = [
  "railway",
  "render.com",
  "supabase",
  "neon.tech",
  "amazonaws.com",
  "heroku",
  "rds.amazonaws",
];

function refuseIfProduction() {
  const url = process.env.DATABASE_URL ?? "";
  const looksProd = PROD_HOST_PATTERNS.some((p) => url.includes(p));
  if (!looksProd) return;
  if (process.env.I_KNOW_THIS_IS_PROD === "true") {
    console.warn(
      "[seed] WARNING: running against what looks like a PRODUCTION database (DATABASE_URL matches a managed-host pattern).",
    );
    console.warn(
      "[seed] Proceeding because I_KNOW_THIS_IS_PROD=true was set explicitly.",
    );
    return;
  }
  console.error(
    "[seed] REFUSING TO RUN: DATABASE_URL points at a managed Postgres provider (Railway/Render/Supabase/Neon/etc.).",
  );
  console.error(
    "[seed] This script wipes every table. If you really want to seed production, set I_KNOW_THIS_IS_PROD=true and try again.",
  );
  process.exit(1);
}

async function main() {
  refuseIfProduction();
  await prisma.playbackState.deleteMany();
  await prisma.consumption.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.orderRequest.deleteMany();
  await prisma.queueItem.deleteMany();
  await prisma.song.deleteMany();
  await prisma.product.deleteMany();
  await prisma.tableSession.deleteMany();
  await prisma.table.deleteMany();
  await prisma.user.deleteMany();

  await prisma.table.createMany({
    data: [
      { number: 1, qr_code: "mesa-1", status: TableStatus.available },
      { number: 2, qr_code: "mesa-2", status: TableStatus.available },
      { number: 3, qr_code: "mesa-3", status: TableStatus.available },
      { number: 4, qr_code: "mesa-4", status: TableStatus.available },
      { number: 5, qr_code: "mesa-5", status: TableStatus.available },
      { number: 6, qr_code: "mesa-6", status: TableStatus.available },
    ],
  });

  await prisma.product.createMany({
    data: [
      { name: "Espresso", price: 6000, stock: 50, category: "coffee" },
      { name: "Cappuccino", price: 9500, stock: 40, category: "coffee" },
      { name: "Cheesecake", price: 12000, stock: 15, category: "dessert" },
      { name: "Croissant", price: 8000, stock: 20, category: "bakery" },
    ],
  });

  await prisma.playbackState.upsert({
    where: { id: 1 },
    update: {
      status: "idle",
      queue_item_id: null,
      started_at: null,
      position_seconds: null,
    },
    create: { id: 1, status: "idle" },
  });

  // ─── Admin user ────────────────────────────────────────────────────────
  const adminEmail = (
    process.env.SEED_ADMIN_EMAIL ?? "admin@cafe.local"
  ).toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await prisma.user.create({
    data: {
      name: "Admin",
      email: adminEmail,
      password_hash: passwordHash,
      role: UserRole.admin,
      is_active: true,
    },
  });

  // ─── Table tokens (print so they can be encoded into QR codes) ─────────
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.warn(
      "[seed] JWT_SECRET missing — table tokens will NOT be generated.",
    );
  } else {
    const tables = await prisma.table.findMany({ orderBy: { number: "asc" } });
    console.log("\n─── Table QR tokens ────────────────────────────────────");
    console.log("Encode each into its QR. URL pattern: /mesa/:id?t=<token>");
    for (const t of tables) {
      const token = jwt.sign(
        { kind: "table", table_id: t.id },
        secret,
        { expiresIn: "365d" },
      );
      console.log(`mesa ${String(t.number).padStart(2, "0")} (id=${t.id}): ${token}`);
    }
    console.log("─────────────────────────────────────────────────────────\n");
  }

  console.log(`[seed] admin login: ${adminEmail} / ${adminPassword}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
