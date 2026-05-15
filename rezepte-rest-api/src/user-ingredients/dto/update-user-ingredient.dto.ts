import { PartialType } from '@nestjs/mapped-types';
import { CreateUserIngredientDto } from './create-user-ingredient.dto';

export class UpdateUserIngredientDto extends PartialType(CreateUserIngredientDto) {}
