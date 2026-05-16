import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";
import { sanitizeText } from "../../../common/sanitize";

/**
 * Crear ticket de maleta. El backend FUERZA `amount=5000` — el cliente
 * no lo envía. `ticket_number` debe estar libre (unique partial index lo
 * enforce en BD).
 *
 * Validación de teléfono: aceptamos sólo dígitos (con o sin espacios)
 * para evitar SQL injection / XSS por canales colaterales. 7–15 dígitos
 * cubre formatos colombianos y internacionales razonables.
 */
export class CreateLuggageDto {
  @IsInt()
  @Min(1)
  ticket_number!: number;

  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  customer_first_name!: string;

  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  customer_last_name!: string;

  @Transform(({ value }) =>
    typeof value === "string" ? value.replace(/\s+/g, "") : value,
  )
  @IsString()
  @Matches(/^\+?\d{7,15}$/, {
    message: "customer_phone must be 7-15 digits, optional leading +",
  })
  customer_phone!: string;

  @IsOptional()
  @IsIn(["pending", "paid"])
  payment_status?: "pending" | "paid";

  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MaxLength(200)
  notes?: string;
}
