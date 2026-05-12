import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import type { AuthPayload } from "../auth/types";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { CreateStockMovementDto } from "./dto/create-stock-movement.dto";
import {
  InventoryActor,
  InventoryMovementsService,
} from "./inventory-movements.service";
import { ProductsService } from "./products.service";
import { AuditLogService } from "../audit-log/audit-log.service";

/**
 * Admin product surface (Phase H2).
 *
 * Strict separation from `/products`:
 *   - `/products` returns active items only, no auth.
 *   - `/admin/products` returns everything by default and requires an
 *     admin JWT.
 *
 * Stock changes do NOT live here — they belong to Phase H3
 * (`/admin/products/:id/stock-movements`). Editing the product never
 * touches `stock` directly so every stock delta has an audit row.
 */
@Controller("admin/products")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class AdminProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly movements: InventoryMovementsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  findAll(
    @Query("category") category?: string,
    @Query("include_inactive") includeInactive?: string,
    @Query("low_stock") lowStock?: string,
  ) {
    return this.products.findAllForAdmin({
      category: category?.trim() || undefined,
      // default true: admin sees inactive items unless they explicitly opt out
      includeInactive: includeInactive === "false" ? false : true,
      lowStockOnly: lowStock === "true",
    });
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.products.findOneForAdmin(id);
  }

  @Post()
  async create(@Body() dto: CreateProductDto, @CurrentAuth() auth: AuthPayload) {
    const product = await this.products.create(dto);
    if (auth && auth.kind === "admin") {
      void this.audit.record({
        kind: "product_created",
        actor_id: auth.sub,
        actor_label: auth.name,
        product_id: product.id,
        product_name: product.name,
      });
    }
    return product;
  }

  @Patch(":id")
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    // Snapshot before so the audit row can describe what changed.
    const before = await this.products.findOneForAdmin(id);
    const after = await this.products.update(id, dto);
    if (auth && auth.kind === "admin") {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const keys: (keyof UpdateProductDto)[] = [
        "name",
        "description",
        "price",
        "category",
        "low_stock_threshold",
      ];
      for (const k of keys) {
        const fromVal = (before as unknown as Record<string, unknown>)[k];
        const toVal = (after as unknown as Record<string, unknown>)[k];
        if (fromVal !== toVal && (dto as Record<string, unknown>)[k] != null) {
          changes[k] = { from: fromVal, to: toVal };
        }
      }
      void this.audit.record({
        kind: "product_updated",
        actor_id: auth.sub,
        actor_label: auth.name,
        product_id: after.id,
        product_name: after.name,
        changes,
      });
    }
    return after;
  }

  @Patch(":id/activate")
  async activate(
    @Param("id", ParseIntPipe) id: number,
    @CurrentAuth() auth: AuthPayload,
  ) {
    const product = await this.products.setActive(id, true);
    if (auth && auth.kind === "admin") {
      void this.audit.record({
        kind: "product_activated",
        actor_id: auth.sub,
        actor_label: auth.name,
        product_id: product.id,
        product_name: product.name,
      });
    }
    return product;
  }

  @Patch(":id/deactivate")
  async deactivate(
    @Param("id", ParseIntPipe) id: number,
    @CurrentAuth() auth: AuthPayload,
  ) {
    const product = await this.products.setActive(id, false);
    if (auth && auth.kind === "admin") {
      void this.audit.record({
        kind: "product_deactivated",
        actor_id: auth.sub,
        actor_label: auth.name,
        product_id: product.id,
        product_name: product.name,
      });
    }
    return product;
  }

  // ─── Inventory movements (Phase H3) ─────────────────────────────────────

  @Post(":id/stock-movements")
  async recordStockMovement(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: CreateStockMovementDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    const movement = await this.movements.record(id, dto, toActor(auth));
    if (auth && auth.kind === "admin") {
      // Inventory service returns a slim product shape ({id, stock}); fetch
      // the full row separately for the audit summary. Cheap and avoids
      // changing the service contract just for the log line.
      const product = await this.products.findOneForAdmin(id).catch(() => null);
      void this.audit.record({
        kind: "inventory_movement",
        actor_id: auth.sub,
        actor_label: auth.name,
        product_id: id,
        product_name: product?.name ?? `producto #${id}`,
        movement_type: dto.type,
        quantity: dto.quantity,
        reason: dto.reason ?? null,
      });
    }
    return movement;
  }

  @Get(":id/stock-movements")
  listStockMovements(
    @Param("id", ParseIntPipe) id: number,
    @Query("limit") limit?: string,
  ) {
    return this.movements.listForProduct(id, {
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }
}

/**
 * Narrow the auth payload to the audit shape the service expects. The
 * @AuthKinds("admin") decorator on the controller already guarantees the
 * payload kind, so this is just a type narrow.
 */
function toActor(auth: AuthPayload | undefined): InventoryActor {
  if (!auth || auth.kind !== "admin") return null;
  return { user_id: auth.sub, name: auth.name };
}
