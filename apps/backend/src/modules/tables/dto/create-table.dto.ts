import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { TableStatus } from "@prisma/client";

export class CreateTableDto {
  @IsString()
  @IsNotEmpty()
  qr_code!: string;

  @IsOptional()
  @IsEnum(TableStatus)
  status?: TableStatus;
}
