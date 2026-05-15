import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

/**
 * Una entrada `{ option_id, quantity }` por opción usada en un slot.
 * La suma de quantities debe ser == slot.quantity (lo enforce el
 * service al aceptar el pedido).
 */
class OptionSelectionDto {
  @IsInt()
  @IsPositive()
  option_id!: number;

  @IsInt()
  @Min(0)
  quantity!: number;
}

class SlotSelectionDto {
  @IsInt()
  @IsPositive()
  slot_id!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OptionSelectionDto)
  options!: OptionSelectionDto[];
}

class UnitDto {
  // Composición específica de ESTA unidad del item compuesto.
  // Opcional: si no viene, el backend usa los `default_quantity` de
  // cada opción del slot.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SlotSelectionDto)
  composition?: SlotSelectionDto[];
}

class CreateOrderRequestItemDto {
  @IsInt()
  @IsPositive()
  product_id!: number;

  // Para productos simples y compuestos fijos. Mutuamente excluyente
  // con `units` (el service valida).
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(50)
  quantity?: number;

  // Para compuestos armables — una entrada por unidad. Si quantity y
  // units vienen juntos, debe coincidir units.length === quantity (el
  // service valida).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UnitDto)
  units?: UnitDto[];
}

export class CreateOrderRequestDto {
  @IsInt()
  @IsPositive()
  table_session_id!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderRequestItemDto)
  items!: CreateOrderRequestItemDto[];
}
