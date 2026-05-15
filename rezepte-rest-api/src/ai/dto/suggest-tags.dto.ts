import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class TagIngredientDto {
  @IsString()
  @MaxLength(200)
  name!: string;
}

class TagStepDto {
  @IsString()
  @MaxLength(2000)
  text!: string;
}

export class SuggestTagsDto {
  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TagIngredientDto)
  ingredients!: TagIngredientDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TagStepDto)
  steps!: TagStepDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  durationMinutes?: number | null;
}
