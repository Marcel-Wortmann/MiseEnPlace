import { IsArray, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateUserIngredientDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsNumber()
  @Min(0)
  @Max(2000)
  kcalPer100g!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  proteinPer100g?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  carbsPer100g?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  fatPer100g?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  defaultGramsPerPiece?: number | null;
}
