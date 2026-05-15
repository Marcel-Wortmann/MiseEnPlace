import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpsertMealPlanDto {
  @IsDateString()
  date!: string;

  @IsIn(['fruehstueck', 'mittag', 'abend'])
  slot!: 'fruehstueck' | 'mittag' | 'abend';

  @IsOptional()
  @IsUUID()
  recipeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customText?: string | null;
}
