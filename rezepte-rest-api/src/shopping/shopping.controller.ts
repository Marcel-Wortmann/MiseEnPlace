import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { ShoppingService } from './shopping.service';
import { AddRecipeToShoppingListDto, CreateShoppingItemDto, UpdateShoppingItemDto } from './dto/shopping.dto';
import { ShoppingListItem } from '@shared/interfaces/shopping.interface';

@UseGuards(JwtAuthGuard)
@Controller('shopping')
export class ShoppingController {
  constructor(private readonly service: ShoppingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ShoppingListItem[]> {
    return this.service.list(user.userId);
  }

  @Post()
  add(@CurrentUser() user: AuthUser, @Body() dto: CreateShoppingItemDto): Promise<ShoppingListItem> {
    return this.service.addManual(user.userId, dto);
  }

  @Post('from-recipe')
  addFromRecipe(@CurrentUser() user: AuthUser, @Body() dto: AddRecipeToShoppingListDto): Promise<ShoppingListItem[]> {
    return this.service.addRecipe(user.userId, dto);
  }

  @Post('from-plan')
  addFromPlan(
    @CurrentUser() user: AuthUser,
    @Body() dto: { from: string; to: string },
  ): Promise<ShoppingListItem[]> {
    return this.service.addPlanWeek(user.userId, dto.from, dto.to);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShoppingItemDto,
  ): Promise<ShoppingListItem> {
    return this.service.update(id, user.userId, dto);
  }

  @Delete('done')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearDone(@CurrentUser() user: AuthUser): Promise<void> {
    return this.service.clearDone(user.userId);
  }

  @Delete('all')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearAll(@CurrentUser() user: AuthUser): Promise<void> {
    return this.service.clearAll(user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.service.remove(id, user.userId);
  }
}
