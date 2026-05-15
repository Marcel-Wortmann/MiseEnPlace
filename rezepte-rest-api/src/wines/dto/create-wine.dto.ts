import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';

const RATINGS = ['schlecht', 'okay', 'gut', 'sehr_gut'] as const;
const WINE_TYPES = ['rot', 'weiss', 'rose', 'schaumwein'] as const;

export class CreateWineDto {
  @IsString()
  @MaxLength(500)
  imagePath!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imagePathBack?: string | null;

  @IsOptional()
  @IsIn(RATINGS)
  rating?: 'schlecht' | 'okay' | 'gut' | 'sehr_gut' | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1800)
  @Max(2100)
  vintage?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  grape?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  winery?: string | null;

  @IsOptional()
  @IsIn(WINE_TYPES)
  wineType?: 'rot' | 'weiss' | 'rose' | 'schaumwein' | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  tastingNotes?: string | null;

  @IsOptional()
  @IsBoolean()
  needsReview?: boolean;
}
