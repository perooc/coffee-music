import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Product } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { ProductAvailabilityService } from "./product-availability.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

/**
 * Public-facing product is the same row but with computed flags so the
 * frontend never has to compare numbers itself. Naming follows the rest of
 * the API (`is_*` snake_case).
 *
 * `availability` se incluye sólo para productos compuestos (los que
 * tienen receta). Para simples, el cliente cae al check `stock > 0`.
 */
export type SerializedProduct = Omit<Product, "price"> & {
  price: number;
  is_low_stock: boolean;
  is_out_of_stock: boolean;
  availability?: "available" | "out_of_stock";
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: ProductAvailabilityService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Notifica a clientes (mesa) y staff que la lista de productos cambió.
   * Cuando se pasa una lista de `productIds`, se emite también el conjunto
   * de productos que dependen de cualquiera de ellos como componente — un
   * cambio de stock en una cerveza puede dejar agotados varios cubetazos.
   *
   * No throw: si la consulta falla, se ignora; la UI sigue funcionando
   * porque puede recargar manualmente o esperar el próximo evento.
   */
  async broadcastChanged(productIds?: number[]): Promise<void> {
    try {
      const ids = productIds && productIds.length > 0
        ? await this.expandToDependentComposites(productIds)
        : null;
      const products = await this.prisma.product.findMany({
        where: ids ? { id: { in: ids } } : { is_active: true },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      });
      if (products.length === 0) return;
      const availabilityMap = await this.availability.computeForProducts(
        products.map((p) => p.id),
      );
      const payload = products.map((p) =>
        this.serialize(p, availabilityMap.get(p.id)),
      );
      this.realtime.emitProductUpdated({ products: payload });
    } catch {
      // best-effort; no throw on broadcast path
    }
  }

  /**
   * Dado un set de productos cuyo stock o atributos cambiaron, devuelve el
   * conjunto ampliado que incluye además todos los compuestos que usan
   * alguno de ellos como componente. Así el broadcast cubre dependencias
   * indirectas (e.g., bajar stock de Aguila marca como agotados los
   * cubetazos que dependen de ella).
   */
  private async expandToDependentComposites(
    productIds: number[],
  ): Promise<number[]> {
    const options = await this.prisma.productRecipeOption.findMany({
      where: { component_id: { in: productIds } },
      select: { slot: { select: { product_id: true } } },
    });
    const ids = new Set<number>(productIds);
    for (const o of options) ids.add(o.slot.product_id);
    return Array.from(ids);
  }

  // ─── Public read: cart / catalog ────────────────────────────────────────
  // Customers only see active products. Inactive products stay in the DB
  // for order history integrity (Order.product_id references survive).
  async findAllForCustomers(): Promise<SerializedProduct[]> {
    const products = await this.prisma.product.findMany({
      where: { is_active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    const availabilityMap = await this.availability.computeForProducts(
      products.map((p) => p.id),
    );
    return products.map((p) => this.serialize(p, availabilityMap.get(p.id)));
  }

  // ─── Admin reads ────────────────────────────────────────────────────────
  // Default: ocultar inactivos. `includeInactive=true` lo agrega.
  async findAllForAdmin(filter?: {
    category?: string;
    includeInactive?: boolean;
    lowStockOnly?: boolean;
  }): Promise<SerializedProduct[]> {
    const where: Prisma.ProductWhereInput = {};
    if (filter?.category) where.category = filter.category;
    // Default: false (ocultar inactivos). Sólo si el caller pasa
    // explicitamente true los muestra.
    if (filter?.includeInactive !== true) where.is_active = true;

    const products = await this.prisma.product.findMany({
      where,
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    const availabilityMap = await this.availability.computeForProducts(
      products.map((p) => p.id),
    );
    const serialized = products.map((p) =>
      this.serialize(p, availabilityMap.get(p.id)),
    );
    if (filter?.lowStockOnly) {
      return serialized.filter((p) => p.is_low_stock || p.is_out_of_stock);
    }
    return serialized;
  }

  async findOneForAdmin(id: number): Promise<SerializedProduct> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    const availabilityMap = await this.availability.computeForProducts([
      product.id,
    ]);
    return this.serialize(product, availabilityMap.get(product.id));
  }

  // ─── Admin writes ───────────────────────────────────────────────────────
  async create(dto: CreateProductDto): Promise<SerializedProduct> {
    // SKU es @unique + NOT NULL en la DB. Si el operador no manda uno
    // (la UI actual no expone el campo), lo generamos desde un slug
    // del nombre + timestamp corto para evitar colisiones.
    const sku = dto.sku?.trim() || this.generateSku(dto.name);
    const product = await this.prisma.product.create({
      data: {
        sku,
        name: dto.name,
        description: dto.description ?? null,
        price: dto.price,
        stock: dto.stock ?? 0,
        low_stock_threshold: dto.low_stock_threshold ?? 0,
        category: dto.category,
        is_active: dto.is_active ?? true,
      },
    });
    return this.serialize(product);
  }

  private generateSku(name: string): string {
    const slug = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40);
    const suffix = Date.now().toString(36);
    return `${slug || "product"}_${suffix}`;
  }

  /**
   * Admin edit of metadata. Stock is intentionally NOT writable here:
   * stock changes go through InventoryMovement (Phase H3) so we always
   * have an audit row with reason/created_by. is_active also has its own
   * dedicated endpoints (`activate` / `deactivate`) for clarity.
   */
  async update(id: number, dto: UpdateProductDto): Promise<SerializedProduct> {
    await this.requireExists(id);
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        price: dto.price,
        low_stock_threshold: dto.low_stock_threshold,
        category: dto.category,
      },
    });
    return this.serialize(product);
  }

  async setActive(id: number, isActive: boolean): Promise<SerializedProduct> {
    await this.requireExists(id);
    const product = await this.prisma.product.update({
      where: { id },
      data: { is_active: isActive },
    });
    return this.serialize(product);
  }

  // ─── Internals ──────────────────────────────────────────────────────────
  private async requireExists(id: number) {
    const exists = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException({
        message: `Product ${id} not found`,
        code: "PRODUCT_NOT_FOUND",
      });
    }
  }

  serialize(
    product: Product,
    availability?: "available" | "out_of_stock",
  ): SerializedProduct {
    const stock = product.stock;
    const threshold = product.low_stock_threshold;
    const base: SerializedProduct = {
      ...product,
      price: Number(product.price),
      is_low_stock: threshold > 0 && stock > 0 && stock <= threshold,
      is_out_of_stock: stock <= 0,
    };
    // Para productos compuestos, los flags `is_*_stock` calculados
    // arriba miran el stock propio del compuesto — que para los
    // compuestos no significa nada (siempre suele estar fijo en un
    // valor grande). Lo que importa es la disponibilidad real
    // (derivada del stock de los componentes). Sobrescribimos para
    // que la grilla del admin y los reports reflejen la verdad.
    if (availability !== undefined) {
      base.availability = availability;
      base.is_out_of_stock = availability === "out_of_stock";
      // Compuestos no tienen "low stock" propio. Si todos los
      // componentes están bajos pero presentes, el agregado es
      // tema operativo aparte; no lo mezclamos en este flag.
      base.is_low_stock = false;
    }
    return base;
  }
}
