import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";

/**
 * Calcula disponibilidad binaria de productos compuestos.
 *
 * En V1 sólo devolvemos "available" / "out_of_stock", sin números.
 * Regla:
 *   - Un compuesto está "available" si existe AL MENOS UNA combinación
 *     válida que satisfaga todos los slots dado el stock actual de los
 *     componentes.
 *   - Un slot está "satisfacible" si la suma de stocks de sus opciones
 *     es >= slot.quantity (las armables permiten redistribuir; las
 *     fijas tienen 1 sola opción y caen al mismo caso).
 *
 * No miramos `is_active` del componente porque desactivado = "no se
 * puede usar" en la práctica; el operador puede haber sacado uno y
 * el cubetazo sigue armable con el otro. Si todas las opciones de un
 * slot están inactivas, eso ya lo marca el stock=0 implícito.
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
      const allSlotsSatisfiable = productSlots.every((slot) => {
        const totalAvailable = slot.options.reduce(
          (acc, opt) => acc + (opt.component?.stock ?? 0),
          0,
        );
        return totalAvailable >= slot.quantity;
      });
      result.set(
        productId,
        allSlotsSatisfiable ? "available" : "out_of_stock",
      );
    }
    return result;
  }
}
