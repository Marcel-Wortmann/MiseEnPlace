import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRecipeIdeaDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imagePath?: string | null;
}
