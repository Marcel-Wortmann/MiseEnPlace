import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SuggestRestaurantTagsDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cuisine?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
