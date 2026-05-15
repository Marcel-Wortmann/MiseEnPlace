import { IsArray, IsInt, IsOptional, IsString, IsUrl, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RecipeIngredientDto } from '../../recipes/dto/create-recipe.dto';

export class ExtractFromUrlDto {
  @IsUrl({ require_protocol: true })
  url!: string;
}

export class EstimateCaloriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients!: RecipeIngredientDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  servings?: number | null;

  @IsOptional()
  @IsString()
  title?: string | null;
}
