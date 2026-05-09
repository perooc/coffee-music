import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateBarDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;
}
