import { PartialType } from '@nestjs/mapped-types';
import { CreateRecipeIdeaDto } from './create-recipe-idea.dto';

export class UpdateRecipeIdeaDto extends PartialType(CreateRecipeIdeaDto) {}
