import { PrismaClient, TableStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.queueItem.deleteMany();
  await prisma.song.deleteMany();
  await prisma.product.deleteMany();
  await prisma.table.deleteMany();

  await prisma.table.createMany({
    data: [
      { qr_code: "mesa-1", status: TableStatus.available },
      { qr_code: "mesa-2", status: TableStatus.available },
      { qr_code: "mesa-3", status: TableStatus.available },
      { qr_code: "mesa-4", status: TableStatus.available },
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
