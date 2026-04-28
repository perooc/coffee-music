import { Transform } from "class-transformer";
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  NotEquals,
} from "class-validator";
import { sanitizeText } from "../../../common/sanitize";

export enum AdjustmentKind {
  adjustment = "adjustment",
  discount = "discount",
}

/**
 * Body shape for POST /bill/:sessionId/adjustments.
 *
 * `created_by` is intentionally NOT accepted here. The backend writes it from
 * the authenticated user (req.auth) — see ConsumptionsController + Phase G6
 * tests. With ValidationPipe `forbidNonWhitelisted` on, sending it from the
 * client now returns a 400 instead of being silently dropped.
 */
export class CreateAdjustmentDto {
  @IsEnum(AdjustmentKind)
  type!: AdjustmentKind;

  @IsNumber({ maxDecimalPlaces: 2 })
  @NotEquals(0)
  amount!: number;

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
