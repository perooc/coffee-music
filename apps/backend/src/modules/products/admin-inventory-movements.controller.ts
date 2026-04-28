import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InventoryMovementType } from "@prisma/client";
import { AuthKinds } from "../auth/guards/decorators";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { InventoryMovementsService } from "./inventory-movements.service";

/**
 * Global ledger view of every manual stock change (restock, waste,
 * adjustment, correction). Per-product history lives under
 * /admin/products/:id/stock-movements.
 */
@Controller("admin/inventory-movements")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class AdminInventoryMovementsController {
  constructor(private readonly service: InventoryMovementsService) {}

  @Get()
  list(
    @Query("type") type?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedType = parseType(type);
    const parsedFrom = parseIsoDate(from, "from");
    const parsedTo = parseIsoDate(to, "to");
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.service.listGlobal({
      type: parsedType,
      from: parsedFrom,
      to: parsedTo,
      limit: parsedLimit,
    });
  }
}

function parseType(raw?: string): InventoryMovementType | undefined {
  if (!raw) return undefined;
  const allowed = Object.values(InventoryMovementType);
  if (!allowed.includes(raw as InventoryMovementType)) {
    throw new BadRequestException({
      message: `Invalid type. Allowed: ${allowed.join(", ")}`,
      code: "INVENTORY_INVALID_TYPE_FILTER",
    });
  }
  return raw as InventoryMovementType;
}

function parseIsoDate(raw: string | undefined, field: string): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException({
      message: `Invalid ISO date for ${field}`,
      code: "INVENTORY_INVALID_DATE_FILTER",
    });
  }
  return d;
}
