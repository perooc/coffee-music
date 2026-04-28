import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  InventoryMovement,
  InventoryMovementType,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { CreateStockMovementDto } from "./dto/create-stock-movement.dto";

/** Same shape we use elsewhere — server is the only source for created_by. */
export type InventoryActor = {
  user_id: number;
  name: string;
} | null;

@Injectable()
export class InventoryMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a manual stock change. The whole flow runs inside a transaction
   * so the InventoryMovement row and Product.stock update either both land
   * or neither does — there is never an audit row without a stock change
   * (or vice versa).
   *
   * Sign rules per type:
   *   restock    > 0
   *   waste      < 0
   *   adjustment != 0
   *   correction != 0
   *
   * Post-condition: Product.stock + quantity >= 0. If that would underflow
   * we throw STOCK_WOULD_GO_NEGATIVE with the diagnostic context the UI
   * needs to show a helpful error.
   */
  async record(
    productId: number,
    dto: CreateStockMovementDto,
    actor: InventoryActor = null,
  ): Promise<InventoryMovement & { product: { id: number; stock: number } }> {
    this.validateSign(dto.type, dto.quantity);

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, stock: true },
      });
      if (!product) {
        throw new NotFoundException({
          message: `Product ${productId} not found`,
          code: "PRODUCT_NOT_FOUND",
        });
      }

      const nextStock = product.stock + dto.quantity;
      if (nextStock < 0) {
        throw new ConflictException({
          message: "Stock would go negative",
          code: "STOCK_WOULD_GO_NEGATIVE",
          current_stock: product.stock,
          attempted_delta: dto.quantity,
        });
      }

      const movement = await tx.inventoryMovement.create({
        data: {
          product_id: productId,
          type: dto.type,
          quantity: dto.quantity,
          reason: dto.reason,
          notes: dto.notes ?? null,
          // Audit rule (G6): server overrides anything the client could have
          // tried to inject. DTOs no longer expose created_by either.
          created_by: actor?.name ?? null,
        },
      });

      const updated = await tx.product.update({
        where: { id: productId },
        data: { stock: nextStock },
        select: { id: true, stock: true },
      });

      return { ...movement, product: updated };
    });
  }

  async listForProduct(
    productId: number,
    opts?: { limit?: number },
  ): Promise<InventoryMovement[]> {
    await this.requireProductExists(productId);
    const limit = clampLimit(opts?.limit);
    return this.prisma.inventoryMovement.findMany({
      where: { product_id: productId },
      orderBy: { created_at: "desc" },
      take: limit,
    });
  }

  async listGlobal(opts?: {
    type?: InventoryMovementType;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<InventoryMovement[]> {
    const limit = clampLimit(opts?.limit);
    const where: Prisma.InventoryMovementWhereInput = {};
    if (opts?.type) where.type = opts.type;
    if (opts?.from || opts?.to) {
      where.created_at = {};
      if (opts.from) where.created_at.gte = opts.from;
      if (opts.to) where.created_at.lte = opts.to;
    }
    return this.prisma.inventoryMovement.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
    });
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private validateSign(type: InventoryMovementType, quantity: number) {
    if (type === InventoryMovementType.restock && quantity <= 0) {
      throw new BadRequestException({
        message: "Restock quantity must be positive",
        code: "INVENTORY_RESTOCK_MUST_BE_POSITIVE",
      });
    }
    if (type === InventoryMovementType.waste && quantity >= 0) {
      throw new BadRequestException({
        message: "Waste quantity must be negative",
        code: "INVENTORY_WASTE_MUST_BE_NEGATIVE",
      });
    }
    // adjustment/correction: only the != 0 invariant matters; class-validator
    // already enforces it via @NotEquals(0). Defense in depth here in case
    // the DTO is bypassed by a future internal caller.
    if (quantity === 0) {
      throw new BadRequestException({
        message: "Quantity cannot be zero",
        code: "INVENTORY_INVALID_QUANTITY",
      });
    }
  }

  private async requireProductExists(productId: number) {
    const exists = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException({
        message: `Product ${productId} not found`,
        code: "PRODUCT_NOT_FOUND",
      });
    }
  }
}

function clampLimit(raw?: number): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 50;
  if (n < 1) return 1;
  if (n > 200) return 200;
  return Math.floor(n);
}
