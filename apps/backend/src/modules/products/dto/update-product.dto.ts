import { Transform } from "class-transformer";
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { sanitizeText } from "../../../common/sanitize";

/**
 * Editable product metadata. Stock is intentionally absent: stock changes
 * always go through InventoryMovement (Phase H3) so they are auditable.
 * is_active also has dedicated endpoints (`activate`/`deactivate`) for
 * clarity, so it does not belong here either.
 */
export class UpdateProductDto {
  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  low_stock_threshold?: number;

  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  category?: string;
}
