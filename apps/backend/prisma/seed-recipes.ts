/**
 * Seed de recetas: idempotente, append/update por SKU.
 *
 * No borra ni destruye nada. Si lo corrés N veces, queda igual.
 *
 * Pasos:
 *   1. Asignar SKU semántico a los productos existentes (cervezas, licores,
 *      cubetazos fijos, sixpacks, combos) buscándolos por nombre exacto.
 *      Los nombres están hardcodeados acá; si renombrás un producto en la
 *      UI futura, el seed deja de reconocerlo y conserva el SKU
 *      `legacy_<id>` que tiene de la migración anterior.
 *   2. Crear (o updatear) los productos compuestos armables nuevos:
 *      Cubetazo aguila/poker + 5 combos aguila/poker.
 *   3. Cargar la receta de cada compuesto (slots + opciones).
 *   4. Desactivar el duplicado MEDIA ANTIOQUEÑO AZUL ($50.000, sin uso
 *      como componente).
 *
 * Uso:
 *   npm run seed:recipes --workspace=@coffee-bar/backend
 *
 * En prod: corré primero contra una copia de la DB para inspeccionar
 * los logs. El script es read-mostly seguro pero el costo de un bug
 * de naming es alto (se crearían duplicados).
 */

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Mapeo SKU → nombre exacto del producto existente ────────────────────
// Si el nombre en la DB no coincide exactamente, el seed loggea y sigue.

const COMPONENT_SKUS: Record<string, string> = {
  // Cervezas
  beer_aguila_lata: "Aguila lata 330 ml",
  beer_aguila_light_botella: "Aguila ligth Botella 330 ml",
  beer_aguila_negra_botella: "Aguila Negra botella 330 ml",
  beer_budweiser_lata: "Budweiser Lata 269 ml",
  beer_club_dorada_botella: "Club Dorada botella 330ml",
  beer_club_dorada_lata: "Club Dorada lata 330 ml",
  beer_club_roja_lata: "Club Roja lata 330 ml",
  beer_club_trigo_botella: "Club trigo botella 330 ml",
  beer_coronita: "Coronita 273 ml",
  beer_poker_botella: "Poker botella 330 ml",
  beer_poker_lata: "Poker lata 330",
  beer_redds_citrus_lata: "Redd's Citrus lata 269 ml",
  beer_stella_artois: "Stella Artois 330 ml",

  // Licores (los que aparecen como componente de combos)
  liquor_nectar_verde_media: "Media de Nectar verde",
  liquor_nectar_azul_media: "Media de Nectar azul",
  liquor_antioqueno_azul_media: "MEDIA ANTIOQUEÑO AZUL",
  liquor_antioqueno_verde_media: "Media de Antioqueño verde",
  liquor_amarillo_media: "Medio de Amarillo",
  liquor_amarillo_litro: "Litro de nectar verde",
};

// ─── Compuestos existentes y sus recetas ──────────────────────────────────
// Cada entrada: SKU del compuesto → nombre + slots.
// "name" es el nombre tal como está en DB (para encontrarlo por nombre la
// primera vez). Si el compuesto ya tiene SKU (porque se corrió antes),
// se busca por SKU directo.
//
// Cada slot.options trae [component_sku, default_quantity] tuples.

type ExistingComposite = {
  sku: string;
  name: string;
  slots: Array<{
    label: string;
    quantity: number;
    options: Array<[string, number]>; // [component_sku, default_qty]
  }>;
};

const EXISTING_COMPOSITES: ExistingComposite[] = [
  // ─── Cubetazos fijos ───
  {
    sku: "bucket_aguila_negra",
    name: "Cubetazo botella aguila Negra",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_aguila_negra_botella", 6]],
      },
    ],
  },
  {
    sku: "bucket_poker",
    name: "Cubetazo botella poker",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_poker_botella", 6]],
      },
    ],
  },
  {
    sku: "bucket_club_trigo",
    name: "Cubetazo club trigo botella",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_club_trigo_botella", 6]],
      },
    ],
  },
  {
    sku: "bucket_aguila_light",
    name: "Cubetazo Aguila Ligth",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_aguila_light_botella", 6]],
      },
    ],
  },
  {
    sku: "bucket_club_dorada",
    name: "Cubetazo club dorada botella",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_club_dorada_botella", 6]],
      },
    ],
  },
  {
    sku: "bucket_stella_artois",
    name: "Cubetazo Stella Artois 330 ml",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_stella_artois", 6]],
      },
    ],
  },
  {
    sku: "bucket_coronita",
    name: "Cubetazo de coronita",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_coronita", 6]],
      },
    ],
  },

  // ─── Sixpacks ───
  {
    sku: "sixpack_club_dorada_lata",
    name: "Sixpack Club Dorada lata 330 ml",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_club_dorada_lata", 6]],
      },
    ],
  },
  {
    sku: "sixpack_budweiser_lata",
    name: "Sixpack Budweiser Lata 269 ml",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_budweiser_lata", 6]],
      },
    ],
  },
  {
    sku: "sixpack_redds_citrus_lata",
    name: "Sixpack Redd's Citrus lata 269 ml",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_redds_citrus_lata", 6]],
      },
    ],
  },
  {
    sku: "sixpack_aguila_lata",
    name: "Sixpack Aguila lata 330 ml",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_aguila_lata", 6]],
      },
    ],
  },
  {
    sku: "sixpack_poker_lata",
    name: "Sixpack Poker lata 330",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_poker_lata", 6]],
      },
    ],
  },
  {
    sku: "sixpack_club_roja_lata",
    name: "Sixpack Club Roja lata 330 ml",
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [["beer_club_roja_lata", 6]],
      },
    ],
  },

  // ─── Combos Aguila Negra + licor ───
  {
    sku: "combo_aguila_negra_nectar_verde",
    name: "Cubetazo botella aguila negra + media de aguardiente Nectar Verde",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_aguila_negra_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_nectar_verde_media", 1]] },
    ],
  },
  {
    sku: "combo_aguila_negra_nectar_azul",
    name: "Cubetazo botella aguila negra + media de aguardiente Nectar azul",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_aguila_negra_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_nectar_azul_media", 1]] },
    ],
  },
  {
    sku: "combo_aguila_negra_antioqueno_azul",
    name: "Cubetazo botella aguila negra + media de aguardiente antioqueño azul",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_aguila_negra_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_antioqueno_azul_media", 1]] },
    ],
  },
  {
    sku: "combo_aguila_negra_antioqueno_verde",
    name: "Cubetazo botella aguila negra + media de antioqueño verde",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_aguila_negra_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_antioqueno_verde_media", 1]] },
    ],
  },
  {
    sku: "combo_aguila_negra_amarillo",
    name: "Cubetazo botella aguila negra + media de amarillo",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_aguila_negra_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_amarillo_media", 1]] },
    ],
  },
  {
    sku: "combo_aguila_negra_amarillo_litro",
    name: "Cubetazo botella aguila negra + Litro de amarillo",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_aguila_negra_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_amarillo_litro", 1]] },
    ],
  },

  // ─── Combos Aguila Light + licor ───
  {
    sku: "combo_aguila_light_nectar_verde",
    name: "Cubetazo botella aguila Ligth + media de aguardiente Nectar Verde",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_aguila_light_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_nectar_verde_media", 1]] },
    ],
  },
  {
    sku: "combo_aguila_light_nectar_azul",
    name: "Cubetazo botella aguila Ligth + media de aguardiente Nectar azul",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_aguila_light_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_nectar_azul_media", 1]] },
    ],
  },
  {
    sku: "combo_aguila_light_antioqueno_azul",
    name: "Cubetazo botella aguila Ligth + media de aguardiente antioqueño azul",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_aguila_light_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_antioqueno_azul_media", 1]] },
    ],
  },
  {
    sku: "combo_aguila_light_antioqueno_verde",
    name: "Cubetazo botella aguila Ligth + media de antioqueño verde",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_aguila_light_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_antioqueno_verde_media", 1]] },
    ],
  },
  {
    sku: "combo_aguila_light_amarillo",
    name: "Cubetazo botella aguila Ligth + media de amarillo",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_aguila_light_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_amarillo_media", 1]] },
    ],
  },

  // ─── Combos Poker + licor ───
  {
    sku: "combo_poker_nectar_verde",
    name: "Cubetazo botella poker + media de aguardiente Nectar Verde",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_poker_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_nectar_verde_media", 1]] },
    ],
  },
  {
    sku: "combo_poker_nectar_azul",
    name: "Cubetazo botella poker + media de aguardiente Nectar azul",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_poker_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_nectar_azul_media", 1]] },
    ],
  },
  {
    sku: "combo_poker_antioqueno_azul",
    name: "Cubetazo botella poker + media de aguardiente antioqueño azul",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_poker_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_antioqueno_azul_media", 1]] },
    ],
  },
  {
    sku: "combo_poker_antioqueno_verde",
    name: "Cubetazo botella poker + media de antioqueño verde",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_poker_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_antioqueno_verde_media", 1]] },
    ],
  },
  {
    sku: "combo_poker_amarillo",
    name: "Cubetazo botella poker + media de amarillo",
    slots: [
      { label: "Cervezas", quantity: 6, options: [["beer_poker_botella", 6]] },
      { label: "Licor", quantity: 1, options: [["liquor_amarillo_media", 1]] },
    ],
  },
];

// ─── Productos NUEVOS a crear (no existen aún) ────────────────────────────
// Estos no aparecen en EXISTING_COMPOSITES porque no tienen una fila
// previa. Se crean con upsert por SKU.

type NewComposite = {
  sku: string;
  name: string;
  category: string;
  price: number;
  slots: Array<{
    label: string;
    quantity: number;
    options: Array<[string, number]>;
  }>;
};

const NEW_COMPOSITES: NewComposite[] = [
  {
    sku: "bucket_aguila_poker_mix",
    name: "Cubetazo Aguila + Poker (mix)",
    category: "Cubetazo",
    price: 20000,
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [
          ["beer_aguila_negra_botella", 3],
          ["beer_poker_botella", 3],
        ],
      },
    ],
  },
  {
    sku: "combo_aguila_poker_mix_nectar_verde",
    name: "Combo Aguila + Poker (mix) + Media de Nectar Verde",
    category: "Combo",
    price: 60000,
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [
          ["beer_aguila_negra_botella", 3],
          ["beer_poker_botella", 3],
        ],
      },
      {
        label: "Licor",
        quantity: 1,
        options: [["liquor_nectar_verde_media", 1]],
      },
    ],
  },
  {
    sku: "combo_aguila_poker_mix_nectar_azul",
    name: "Combo Aguila + Poker (mix) + Media de Nectar azul",
    category: "Combo",
    price: 60000,
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [
          ["beer_aguila_negra_botella", 3],
          ["beer_poker_botella", 3],
        ],
      },
      {
        label: "Licor",
        quantity: 1,
        options: [["liquor_nectar_azul_media", 1]],
      },
    ],
  },
  {
    sku: "combo_aguila_poker_mix_antioqueno_azul",
    name: "Combo Aguila + Poker (mix) + Media de Antioqueño azul",
    category: "Combo",
    price: 70000,
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [
          ["beer_aguila_negra_botella", 3],
          ["beer_poker_botella", 3],
        ],
      },
      {
        label: "Licor",
        quantity: 1,
        options: [["liquor_antioqueno_azul_media", 1]],
      },
    ],
  },
  {
    sku: "combo_aguila_poker_mix_antioqueno_verde",
    name: "Combo Aguila + Poker (mix) + Media de Antioqueño verde",
    category: "Combo",
    price: 68000,
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [
          ["beer_aguila_negra_botella", 3],
          ["beer_poker_botella", 3],
        ],
      },
      {
        label: "Licor",
        quantity: 1,
        options: [["liquor_antioqueno_verde_media", 1]],
      },
    ],
  },
  {
    sku: "combo_aguila_poker_mix_amarillo",
    name: "Combo Aguila + Poker (mix) + Medio de Amarillo",
    category: "Combo",
    price: 75000,
    slots: [
      {
        label: "Cervezas",
        quantity: 6,
        options: [
          ["beer_aguila_negra_botella", 3],
          ["beer_poker_botella", 3],
        ],
      },
      {
        label: "Licor",
        quantity: 1,
        options: [["liquor_amarillo_media", 1]],
      },
    ],
  },
];

// ─── Productos a desactivar (duplicados) ──────────────────────────────────
const PRODUCTS_TO_DEACTIVATE_BY_NAME = ["Media de Antioqueño azul"];

// ─── Helpers ──────────────────────────────────────────────────────────────

async function ensureSku(name: string, sku: string): Promise<number | null> {
  // Buscar por SKU primero (si ya corrió el seed antes).
  const bySku = await prisma.product.findUnique({ where: { sku } });
  if (bySku) return bySku.id;

  // Buscar por nombre exacto. Si existe, asignarle el SKU.
  const byName = await prisma.product.findFirst({ where: { name } });
  if (!byName) {
    console.warn(`  ⚠ producto no encontrado: "${name}" (sku=${sku})`);
    return null;
  }
  // Si el producto ya tiene un SKU distinto (legacy_X), lo actualizamos.
  if (byName.sku !== sku) {
    await prisma.product.update({
      where: { id: byName.id },
      data: { sku },
    });
    console.log(`  ✓ SKU "${sku}" asignado a "${name}" (id=${byName.id})`);
  }
  return byName.id;
}

async function upsertComposite(item: NewComposite): Promise<number> {
  const existing = await prisma.product.findUnique({
    where: { sku: item.sku },
  });
  if (existing) {
    // Actualizar metadata pero NO el SKU.
    await prisma.product.update({
      where: { id: existing.id },
      data: {
        name: item.name,
        category: item.category,
        price: new Prisma.Decimal(item.price),
        is_active: true,
      },
    });
    console.log(`  ✓ Compuesto existente actualizado: ${item.sku}`);
    return existing.id;
  }
  const created = await prisma.product.create({
    data: {
      sku: item.sku,
      name: item.name,
      category: item.category,
      price: new Prisma.Decimal(item.price),
      stock: 0,
      is_active: true,
    },
  });
  console.log(`  ✓ Compuesto creado: ${item.sku} (id=${created.id})`);
  return created.id;
}

async function replaceRecipe(
  productId: number,
  productName: string,
  slots: ExistingComposite["slots"],
  componentIdBySku: Map<string, number>,
) {
  // Validar primero que todos los SKUs de componentes existan.
  const missing: string[] = [];
  for (const slot of slots) {
    for (const [sku] of slot.options) {
      if (!componentIdBySku.has(sku)) missing.push(sku);
    }
  }
  if (missing.length > 0) {
    console.warn(
      `  ⚠ "${productName}": faltan componentes (${[...new Set(missing)].join(", ")}). Skip.`,
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Borrar receta vieja (cascade borra options).
    await tx.productRecipeSlot.deleteMany({ where: { product_id: productId } });
    // Crear cada slot.
    for (const [slotIdx, slot] of slots.entries()) {
      await tx.productRecipeSlot.create({
        data: {
          product_id: productId,
          label: slot.label,
          quantity: slot.quantity,
          position: slotIdx,
          options: {
            create: slot.options.map(([sku, qty], optIdx) => ({
              component_id: componentIdBySku.get(sku)!,
              default_quantity: qty,
              position: optIdx,
            })),
          },
        },
      });
    }
  });
  console.log(`  ✓ Receta cargada para "${productName}"`);
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Seed de recetas ===\n");

  // 1) Asignar SKU a componentes existentes.
  console.log("Paso 1: SKUs de componentes...");
  const componentIdBySku = new Map<string, number>();
  for (const [sku, name] of Object.entries(COMPONENT_SKUS)) {
    const id = await ensureSku(name, sku);
    if (id != null) componentIdBySku.set(sku, id);
  }
  console.log(
    `  Total componentes mapeados: ${componentIdBySku.size}/${Object.keys(COMPONENT_SKUS).length}\n`,
  );

  // 2) Asignar SKU a los compuestos existentes y cargar sus recetas.
  console.log("Paso 2: Compuestos existentes + recetas...");
  for (const item of EXISTING_COMPOSITES) {
    const id = await ensureSku(item.name, item.sku);
    if (id == null) continue;
    await replaceRecipe(id, item.name, item.slots, componentIdBySku);
  }
  console.log("");

  // 3) Crear/updatear los compuestos nuevos (armables aguila/poker).
  console.log("Paso 3: Compuestos nuevos...");
  for (const item of NEW_COMPOSITES) {
    const id = await upsertComposite(item);
    await replaceRecipe(id, item.name, item.slots, componentIdBySku);
  }
  console.log("");

  // 4) Desactivar duplicados.
  console.log("Paso 4: Desactivar duplicados...");
  for (const name of PRODUCTS_TO_DEACTIVATE_BY_NAME) {
    const result = await prisma.product.updateMany({
      where: { name },
      data: { is_active: false },
    });
    if (result.count > 0) {
      console.log(`  ✓ "${name}" desactivado (${result.count} fila/s)`);
    }
  }

  console.log("\n=== Seed completado ===");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
