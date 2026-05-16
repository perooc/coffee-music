import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { Transform } from "class-transformer";
import { sanitizeText } from "../../../common/sanitize";

/**
 * Registrar un cobro de baño. El frontend NUNCA envía el precio: el
 * backend lo fuerza según `subtype`. Cualquier campo extra se ignora.
 *
 * Subtypes permitidos hoy:
 *   - "male"   → $1.000
 *   - "female" → $2.000
 *
 * Si en el futuro se agrega cover, propinas obligatorias, etc., se crea
 * un DTO/endpoint nuevo por tipo — NO se sobrecarga este.
 */
export class CreateRestroomIncomeDto {
  @IsIn(["male", "female"])
  subtype!: "male" | "female";

  // Notas opcionales (ej. "cliente cobró exacto", "caso especial").
  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MaxLength(200)
  notes?: string;
}
