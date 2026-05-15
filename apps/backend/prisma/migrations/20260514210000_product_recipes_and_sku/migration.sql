-- ==========================================================================
-- Migration: product recipes + SKU + per-order-item component history
-- ==========================================================================
--
-- 1) Agrega Product.sku como NULLABLE primero.
-- 2) Backfill SKU para todos los productos existentes a partir del id
--    (sku = "legacy_<id>"). El seed posterior (apps/backend/prisma/
--    seed-recipes.ts) los actualiza al SKU semántico correcto para
--    los productos que el script reconoce; los demás conservan el
--    "legacy_<id>" y siguen siendo válidos como identidad estable.
-- 3) Pone Product.sku NOT NULL + UNIQUE.
-- 4) Crea ProductRecipeSlot, ProductRecipeOption, OrderItemComponent.
--
-- Hace todo en una sola transacción implícita de Prisma; si algo falla,
-- rollback completo y la base queda como estaba.

-- ── Paso 1: agregar Product.sku como nullable ──────────────────────────
ALTER TABLE "Product" ADD COLUMN "sku" TEXT;

-- ── Paso 2: backfill con identidad legacy basada en id ─────────────────
UPDATE "Product" SET "sku" = 'legacy_' || "id"::text WHERE "sku" IS NULL;

-- ── Paso 3: enforce NOT NULL + UNIQUE ──────────────────────────────────
ALTER TABLE "Product" ALTER COLUMN "sku" SET NOT NULL;
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- ── Paso 4: tablas de recetas ──────────────────────────────────────────
CREATE TABLE "ProductRecipeSlot" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductRecipeSlot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductRecipeOption" (
    "id" SERIAL NOT NULL,
    "slot_id" INTEGER NOT NULL,
    "component_id" INTEGER NOT NULL,
    "default_quantity" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductRecipeOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItemComponent" (
    "id" SERIAL NOT NULL,
    "order_item_id" INTEGER NOT NULL,
    "component_product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderItemComponent_pkey" PRIMARY KEY ("id")
);

-- ── Indices ────────────────────────────────────────────────────────────
CREATE INDEX "ProductRecipeSlot_product_id_idx" ON "ProductRecipeSlot"("product_id");
CREATE INDEX "ProductRecipeOption_component_id_idx" ON "ProductRecipeOption"("component_id");
CREATE UNIQUE INDEX "ProductRecipeOption_slot_id_component_id_key" ON "ProductRecipeOption"("slot_id", "component_id");
CREATE INDEX "OrderItemComponent_order_item_id_idx" ON "OrderItemComponent"("order_item_id");
CREATE INDEX "OrderItemComponent_component_product_id_idx" ON "OrderItemComponent"("component_product_id");

-- ── Foreign keys ───────────────────────────────────────────────────────
ALTER TABLE "ProductRecipeSlot"
  ADD CONSTRAINT "ProductRecipeSlot_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductRecipeOption"
  ADD CONSTRAINT "ProductRecipeOption_slot_id_fkey"
  FOREIGN KEY ("slot_id") REFERENCES "ProductRecipeSlot"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict en component: no permitimos borrar un producto que está
-- siendo usado como componente de alguna receta. La UI debe surfacar
-- el error si el operador lo intenta.
ALTER TABLE "ProductRecipeOption"
  ADD CONSTRAINT "ProductRecipeOption_component_id_fkey"
  FOREIGN KEY ("component_id") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItemComponent"
  ADD CONSTRAINT "OrderItemComponent_order_item_id_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "OrderItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict también para componentes ya consumidos: si una venta usó
-- el producto X como componente, no podemos hard-delete X sin perder
-- la trazabilidad. El operador desactiva y listo.
ALTER TABLE "OrderItemComponent"
  ADD CONSTRAINT "OrderItemComponent_component_product_id_fkey"
  FOREIGN KEY ("component_product_id") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
