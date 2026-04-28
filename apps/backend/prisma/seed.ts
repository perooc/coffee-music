import { PrismaClient, TableStatus, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";

const prisma = new PrismaClient();

async function main() {
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
