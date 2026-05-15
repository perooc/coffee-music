import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";

/**
 * Calcula disponibilidad binaria de productos compuestos.
 *
 * En V1 sólo devolvemos "available" / "out_of_stock", sin números.
 *
 * Regla ESTRICTA (decisión operativa del bar):
 *   - Un compuesto está "available" sí y sólo sí TODAS las opciones de
 *     TODOS sus slots tienen al menos 1 unidad de stock (Y además stock
 *     suficiente para cubrir cualquier reparto que el cliente intente).
 *   - Si CUALQUIER componente listado en una opción tiene stock 0, el
 *     producto compuesto queda "out_of_stock" — aunque otras opciones
 *     del mismo slot tengan stock suficiente.
 *
 * Razón: el cliente espera consistencia. Un cubetazo "mix aguila/poker"
 * con 0 poker está físicamente vendible (6 aguila), pero la promesa
 * del producto es "puede haber poker". Si bloqueamos al mostrar el
 * producto, el cliente no pasa por la frustración de elegir 4+2 y que
 * el server rechace al aceptar. Tradeoff: vendemos menos cuando un
 * componente está agotado. Aceptable.
 *
 * Performance: una sola query a Prisma trae slots + opciones + stock
 * de cada componente; el resto es agregación en memoria. Costo O(n)
 * en el número de slots/opciones por producto, OK para los 30 que
 * tenemos.
 */
@Injectable()
export class ProductAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mapa `product_id → "available" | "out_of_stock"` para los
   * productos cuyo id está en `productIds` Y son compuestos. Los
   * productos no compuestos no aparecen en el mapa (el llamador cae
   * al check `stock > 0` que ya hace).
   */
  async computeForProducts(
    productIds: number[],
  ): Promise<Map<number, "available" | "out_of_stock">> {
    if (productIds.length === 0) return new Map();

    const slots = await this.prisma.productRecipeSlot.findMany({
      where: { product_id: { in: productIds } },
      include: {
        options: {
          include: {
            component: { select: { id: true, stock: true, is_active: true } },
          },
        },
      },
    });

    // Group slots by product.
    const slotsByProduct = new Map<number, typeof slots>();
    for (const slot of slots) {
      const list = slotsByProduct.get(slot.product_id) ?? [];
      list.push(slot);
      slotsByProduct.set(slot.product_id, list);
    }

    const result = new Map<number, "available" | "out_of_stock">();
    for (const [productId, productSlots] of slotsByProduct) {
      // Regla estricta: cada componente listado debe tener stock > 0.
      // Si CUALQUIER opción de CUALQUIER slot tiene stock 0, el
      // compuesto queda agotado. Y además la suma de stocks por slot
      // debe cubrir slot.quantity (chequeo redundante pero explícito).
      const allOk = productSlots.every((slot) => {
        const everyOptionHasStock = slot.options.every(
          (opt) => (opt.component?.stock ?? 0) > 0,
        );
        if (!everyOptionHasStock) return false;
        const totalAvailable = slot.options.reduce(
          (acc, opt) => acc + (opt.component?.stock ?? 0),
          0,
        );
        return totalAvailable >= slot.quantity;
      });
      result.set(productId, allOk ? "available" : "out_of_stock");
    }
    return result;
  }
}
