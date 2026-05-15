import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Product } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { ProductAvailabilityService } from "./product-availability.service";

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
  ) {}

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
    if (availability !== undefined) {
      base.availability = availability;
    }
    return base;
  }
}
