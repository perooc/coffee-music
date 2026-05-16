import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { sanitizeText } from "../../../common/sanitize";

/**
 * Reversar un cobro de extra income. Razón obligatoria — el modelo de
 * negocio exige trazabilidad por qué se anuló (cobro duplicado, error
 * de subtype, etc.). El registro NO se borra; solo cambia de estado.
 */
export class ReverseExtraIncomeDto {
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}
