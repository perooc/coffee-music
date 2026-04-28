-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('restock', 'adjustment', 'waste', 'correction');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "description" TEXT,
ADD COLUMN     "low_stock_threshold" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryMovement_product_id_created_at_idx" ON "InventoryMovement"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "InventoryMovement_type_created_at_idx" ON "InventoryMovement"("type", "created_at");

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
