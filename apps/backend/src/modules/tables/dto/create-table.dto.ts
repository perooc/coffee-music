import { IsEnum, IsOptional, IsString } from "class-validator";
import { TableStatus } from "@prisma/client";

export class CreateTableDto {
  @IsString()
  qr_code!: string;

  @IsOptional()
  @IsEnum(TableStatus)
  status?: TableStatus;
}
