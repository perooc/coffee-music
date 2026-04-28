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
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch(":id")
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(id, dto);
  }

  @Patch(":id/activate")
  activate(@Param("id", ParseIntPipe) id: number) {
    return this.products.setActive(id, true);
  }

  @Patch(":id/deactivate")
  deactivate(@Param("id", ParseIntPipe) id: number) {
    return this.products.setActive(id, false);
  }

  // ─── Inventory movements (Phase H3) ─────────────────────────────────────

  @Post(":id/stock-movements")
  recordStockMovement(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: CreateStockMovementDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.movements.record(id, dto, toActor(auth));
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
