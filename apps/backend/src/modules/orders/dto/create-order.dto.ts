import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsPositive,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class CreateOrderItemDto {
  @IsInt()
  @IsPositive()
  product_id!: number;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class CreateOrderDto {
  @IsInt()
  @IsPositive()
  table_id!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
