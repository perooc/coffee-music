import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class RecipeOptionDto {
  @IsInt()
  @Min(1)
  component_id!: number;

  @IsInt()
  @Min(0)
  default_quantity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class RecipeSlotDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecipeOptionDto)
  options!: RecipeOptionDto[];
}

export class ReplaceRecipeDto {
  // Vacío = quitar la receta (producto pasa a simple). No vacío =
  // reemplaza completamente.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeSlotDto)
  slots!: RecipeSlotDto[];
}
