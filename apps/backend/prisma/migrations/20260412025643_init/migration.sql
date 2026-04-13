CREATE TYPE "TableStatus" AS ENUM ('available', 'active', 'occupied', 'inactive');
CREATE TYPE "QueueStatus" AS ENUM ('pending', 'playing', 'played', 'skipped');
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'preparing', 'ready', 'delivered', 'cancelled');

CREATE TABLE "Table" (
  "id" SERIAL NOT NULL,
  "qr_code" TEXT NOT NULL,
  "status" "TableStatus" NOT NULL DEFAULT 'available',
  "total_consumption" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Song" (
  "id" SERIAL NOT NULL,
  "youtube_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "duration" INTEGER NOT NULL,
  "requested_by_table" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Song_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QueueItem" (
  "id" SERIAL NOT NULL,
  "song_id" INTEGER NOT NULL,
  "table_id" INTEGER NOT NULL,
  "priority_score" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "status" "QueueStatus" NOT NULL DEFAULT 'pending',
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QueueItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "price" DECIMAL(10,2) NOT NULL,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "category" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
  "id" SERIAL NOT NULL,
  "table_id" INTEGER NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'pending',
  "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItem" (
  "id" SERIAL NOT NULL,
  "order_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price" DECIMAL(10,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Table_qr_code_key" ON "Table"("qr_code");
CREATE UNIQUE INDEX "Song_youtube_id_key" ON "Song"("youtube_id");
CREATE INDEX "QueueItem_status_position_idx" ON "QueueItem"("status", "position");
CREATE INDEX "QueueItem_table_id_status_idx" ON "QueueItem"("table_id", "status");
CREATE INDEX "Order_table_id_status_idx" ON "Order"("table_id", "status");
CREATE INDEX "OrderItem_order_id_idx" ON "OrderItem"("order_id");
CREATE INDEX "OrderItem_product_id_idx" ON "OrderItem"("product_id");

ALTER TABLE "Song"
ADD CONSTRAINT "Song_requested_by_table_fkey"
FOREIGN KEY ("requested_by_table") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QueueItem"
ADD CONSTRAINT "QueueItem_song_id_fkey"
FOREIGN KEY ("song_id") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QueueItem"
ADD CONSTRAINT "QueueItem_table_id_fkey"
FOREIGN KEY ("table_id") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order"
ADD CONSTRAINT "Order_table_id_fkey"
FOREIGN KEY ("table_id") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
ADD CONSTRAINT "OrderItem_order_id_fkey"
FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
ADD CONSTRAINT "OrderItem_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
