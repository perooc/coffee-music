-- CreateEnum
CREATE TYPE "TableKind" AS ENUM ('TABLE', 'BAR');

-- AlterEnum
ALTER TYPE "ConsumptionType" ADD VALUE 'partial_payment';

-- AlterTable
ALTER TABLE "Table" ADD COLUMN     "kind" "TableKind" NOT NULL DEFAULT 'TABLE';

-- AlterTable
ALTER TABLE "TableSession" ADD COLUMN     "custom_name" TEXT,
ADD COLUMN     "opened_by" TEXT NOT NULL DEFAULT 'customer';

-- CreateIndex
CREATE INDEX "Table_kind_idx" ON "Table"("kind");
