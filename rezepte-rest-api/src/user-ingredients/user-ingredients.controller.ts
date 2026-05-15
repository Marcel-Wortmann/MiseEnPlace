import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserIngredientsService } from './user-ingredients.service';
import { OpenFoodFactsService, OpenFoodFactsLookup } from '../openfoodfacts/openfoodfacts.service';
import { CreateUserIngredientDto } from './dto/create-user-ingredient.dto';
import { UpdateUserIngredientDto } from './dto/update-user-ingredient.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { UserIngredient } from '@shared/interfaces/user-ingredient.interface';

@Controller('my-ingredients')
export class UserIngredientsController {
  constructor(
    private readonly service: UserIngredientsService,
    private readonly off: OpenFoodFactsService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser): Promise<UserIngredient[]> {
    return this.service.findAllForUser(user.userId);
  }

  @Get('lookup')
  lookupBarcode(@Query('barcode') barcode: string): Promise<OpenFoodFactsLookup> {
    return this.off.lookup(barcode ?? '');
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserIngredientDto): Promise<UserIngredient> {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserIngredientDto,
  ): Promise<UserIngredient> {
    return this.service.update(id, user.userId, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.remove(id, user.userId);
  }
}
