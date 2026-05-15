import { IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

const RATINGS = ['schlecht', 'okay', 'gut', 'sehr_gut'] as const;

export class CreateRestaurantDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cuisine?: string | null;

  @IsOptional()
  @IsIn(RATINGS)
  rating?: typeof RATINGS[number] | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  priceLevel?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imagePath?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateRestaurantDto extends CreateRestaurantDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare name: string;
}
