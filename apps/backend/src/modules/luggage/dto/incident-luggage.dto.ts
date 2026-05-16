import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { sanitizeText } from "../../../common/sanitize";

/**
 * Reportar incidente sobre una maleta (ficha perdida, etc.). Razón
 * obligatoria — la auditoría es el punto de este endpoint. El registro
 * NO se borra y la ficha vuelve a quedar disponible para nuevas.
 */
export class IncidentLuggageDto {
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}
