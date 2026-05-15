import { IsArray, IsString, MaxLength, ValidateNested, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class VoiceCommandStepDto {
  @IsInt()
  order!: number;

  @IsString()
  @MaxLength(2000)
  text!: string;
}

export class VoiceCommandIngredientDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string | null;

  @IsOptional()
  amount?: number | null;
}

export class VoiceCommandDto {
  @IsString()
  @MaxLength(500)
  command!: string;

  @IsString()
  @MaxLength(300)
  recipeTitle!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VoiceCommandStepDto)
  steps!: VoiceCommandStepDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VoiceCommandIngredientDto)
  ingredients!: VoiceCommandIngredientDto[];

  @IsOptional()
  @IsInt()
  currentStep?: number;
}

export interface VoiceCommandResult {
  /** 'navigate' | 'answer' | 'unknown' */
  type: 'navigate' | 'answer' | 'unknown';
  /** Bei navigate: 'next' | 'prev' | 'repeat' | 'step:N' | 'ingredients' | 'pause' | 'exit' */
  action?: string;
  /** Antwort-Text (nur bei answer) */
  message?: string;
}
