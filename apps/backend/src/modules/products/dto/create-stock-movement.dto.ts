import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  NotEquals,
} from "class-validator";
import { InventoryMovementType } from "@prisma/client";
import { sanitizeText } from "../../../common/sanitize";

/**
 * Body for POST /admin/products/:id/stock-movements.
 *
 * Sign convention (Phase H3):
 *   - restock     -> quantity > 0
 *   - waste       -> quantity < 0
 *   - adjustment  -> quantity != 0
 *   - correction  -> quantity != 0
 *
 * The frontend may show "Unidades a desechar: 3" in the UI but always sends
 * the signed delta (quantity: -3). Service-side validation enforces it.
 *
 * `created_by` is intentionally not in the DTO: the backend stamps it from
 * the authenticated admin (Phase G6/G7).
 */
export class CreateStockMovementDto {
  @IsEnum(InventoryMovementType)
  type!: InventoryMovementType;

  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  quantity!: number;

  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MaxLength(500)
  notes?: string;
}
