import { IsNumber, IsPositive } from "class-validator";

export class CreatePartialPaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;
}
