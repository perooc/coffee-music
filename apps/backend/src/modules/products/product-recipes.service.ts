import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

/**
 * Recetas de productos compuestos. Una receta = lista de slots; cada
 * slot tiene una o más opciones (componentes posibles).
 *
 * Reglas:
 *   - slot.quantity = total a descontar por unidad vendida del compuesto.
 *   - sum(option.default_quantity) por slot debe == slot.quantity.
 *     Esto se enforce al guardar la receta (puts).
 *   - Un componente NO puede ser él mismo un compuesto (las recetas
 *     son de un solo nivel — sin sub-recetas — para mantener el
 *     descuento de stock predecible).
 */

export interface RecipeSlotPayload {
  label: string;
  quantity: number;
  position?: number;
  options: RecipeOptionPayload[];
}

export interface RecipeOptionPayload {
  component_id: number;
  default_quantity: number;
  position?: number;
}

export interface SerializedRecipeOption {
  id: number;
  component_id: number;
  default_quantity: number;
  position: number;
  component: {
    id: number;
    name: string;
    sku: string;
    category: string;
    stock: number;
    is_active: boolean;
  };
}

export interface SerializedRecipeSlot {
  id: number;
  label: string;
  quantity: number;
  position: number;
  options: SerializedRecipeOption[];
}

export type SerializedRecipe = SerializedRecipeSlot[];

const SLOT_INCLUDE = {
  options: {
    include: {
      component: {
        select: {
          id: true,
          name: true,
          sku: true,
          category: true,
          stock: true,
          is_active: true,
        },
      },
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ProductRecipeSlotInclude;

@Injectable()
export class ProductRecipesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lee la receta de un producto. Devuelve [] si no tiene receta (el
   * producto se considera "simple" y se descuenta de sí mismo).
   */
  async getForProduct(productId: number): Promise<SerializedRecipe> {
    const slots = await this.prisma.productRecipeSlot.findMany({
      where: { product_id: productId },
      include: SLOT_INCLUDE,
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    return slots.map((s) => ({
      id: s.id,
      label: s.label,
      quantity: s.quantity,
      position: s.position,
      options: s.options.map((o) => ({
        id: o.id,
        component_id: o.component_id,
        default_quantity: o.default_quantity,
        position: o.position,
        component: o.component,
      })),
    }));
  }

  /**
   * Reemplaza la receta entera del producto. Idempotente: borra slots
   * viejos (cascade limpia options), recrea desde cero. Todo en una
   * sola transacción para que si algo falla, la receta vieja queda.
   *
   * Pasar `slots = []` borra la receta y deja el producto como simple.
   */
  async replaceForProduct(
    productId: number,
    slots: RecipeSlotPayload[],
  ): Promise<SerializedRecipe> {
    await this.ensureProductExists(productId);
    this.validatePayload(slots);
    await this.ensureComponentsExistAndAreSimple(slots, productId);

    await this.prisma.$transaction(async (tx) => {
      await tx.productRecipeSlot.deleteMany({
        where: { product_id: productId },
      });
      for (const [slotIdx, slot] of slots.entries()) {
        await tx.productRecipeSlot.create({
          data: {
            product_id: productId,
            label: slot.label,
            quantity: slot.quantity,
            position: slot.position ?? slotIdx,
            options: {
              create: slot.options.map((o, optIdx) => ({
                component_id: o.component_id,
                default_quantity: o.default_quantity,
                position: o.position ?? optIdx,
              })),
            },
          },
        });
      }
    });

    return this.getForProduct(productId);
  }

  /**
   * Comprueba si un producto es compuesto (tiene receta no-vacía).
   * Read-only, sin lock.
   */
  async isComposite(productId: number): Promise<boolean> {
    const count = await this.prisma.productRecipeSlot.count({
      where: { product_id: productId },
    });
    return count > 0;
  }

  // ─── Internals ───────────────────────────────────────────────────────

  private async ensureProductExists(productId: number) {
    const p = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!p) {
      throw new NotFoundException({
        message: `Product ${productId} not found`,
        code: "PRODUCT_NOT_FOUND",
      });
    }
  }

  private validatePayload(slots: RecipeSlotPayload[]) {
    for (const [i, slot] of slots.entries()) {
      if (!slot.label?.trim()) {
        throw new BadRequestException({
          message: `Slot #${i + 1}: label is required`,
          code: "RECIPE_SLOT_LABEL_REQUIRED",
        });
      }
      if (!Number.isInteger(slot.quantity) || slot.quantity <= 0) {
        throw new BadRequestException({
          message: `Slot "${slot.label}": quantity must be a positive integer`,
          code: "RECIPE_SLOT_QUANTITY_INVALID",
        });
      }
      if (!slot.options?.length) {
        throw new BadRequestException({
          message: `Slot "${slot.label}": at least one option is required`,
          code: "RECIPE_SLOT_NO_OPTIONS",
        });
      }
      let sumDefaults = 0;
      const seenComponentIds = new Set<number>();
      for (const opt of slot.options) {
        if (!Number.isInteger(opt.component_id) || opt.component_id <= 0) {
          throw new BadRequestException({
            message: `Slot "${slot.label}": option component_id is invalid`,
            code: "RECIPE_OPTION_COMPONENT_INVALID",
          });
        }
        if (seenComponentIds.has(opt.component_id)) {
          throw new BadRequestException({
            message: `Slot "${slot.label}": component_id ${opt.component_id} listed twice`,
            code: "RECIPE_OPTION_DUPLICATE",
          });
        }
        seenComponentIds.add(opt.component_id);
        if (
          !Number.isInteger(opt.default_quantity) ||
          opt.default_quantity < 0
        ) {
          throw new BadRequestException({
            message: `Slot "${slot.label}": default_quantity must be a non-negative integer`,
            code: "RECIPE_OPTION_QUANTITY_INVALID",
          });
        }
        sumDefaults += opt.default_quantity;
      }
      if (sumDefaults !== slot.quantity) {
        throw new BadRequestException({
          message: `Slot "${slot.label}": sum of default quantities (${sumDefaults}) must equal slot quantity (${slot.quantity})`,
          code: "RECIPE_SLOT_DEFAULTS_MISMATCH",
        });
      }
    }
  }

  private async ensureComponentsExistAndAreSimple(
    slots: RecipeSlotPayload[],
    composite_id: number,
  ) {
    const componentIds = new Set<number>();
    for (const slot of slots) {
      for (const opt of slot.options) {
        if (opt.component_id === composite_id) {
          throw new BadRequestException({
            message: "A product cannot be a component of itself",
            code: "RECIPE_SELF_REFERENCE",
          });
        }
        componentIds.add(opt.component_id);
      }
    }
    if (componentIds.size === 0) return;

    const ids = Array.from(componentIds);
    const components = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const foundIds = new Set(components.map((c) => c.id));
    for (const id of ids) {
      if (!foundIds.has(id)) {
        throw new BadRequestException({
          message: `Component product ${id} not found`,
          code: "RECIPE_COMPONENT_NOT_FOUND",
        });
      }
    }

    // Prevent recursive recipes: no component may itself be a composite.
    // Keeps stock-decrement logic single-level and predictable.
    const compositeComponents = await this.prisma.productRecipeSlot.findMany({
      where: { product_id: { in: ids } },
      select: { product_id: true },
      distinct: ["product_id"],
    });
    if (compositeComponents.length > 0) {
      const conflictIds = compositeComponents.map((c) => c.product_id);
      throw new ConflictException({
        message: `Components cannot be composite products themselves: ${conflictIds.join(", ")}`,
        code: "RECIPE_COMPONENT_IS_COMPOSITE",
        component_ids: conflictIds,
      });
    }
  }
}
