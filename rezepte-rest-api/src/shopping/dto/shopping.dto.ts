import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateShoppingItemDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(20)
  unit?: string | null;
}

export class UpdateShoppingItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(20)
  unit?: string | null;

  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class AddRecipeToShoppingListDto {
  @IsUUID()
  recipeId!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  servingsOverride?: number | null;
}
