import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { sanitizeText } from "../../../common/sanitize";

export class RejectOrderRequestDto {
  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MaxLength(200)
  reason?: string;
}
