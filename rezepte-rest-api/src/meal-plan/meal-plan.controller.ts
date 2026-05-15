import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { MealPlanService } from './meal-plan.service';
import { UpsertMealPlanDto } from './dto/upsert-meal-plan.dto';

@Controller('meal-plan')
@UseGuards(JwtAuthGuard)
export class MealPlanController {
  constructor(private readonly service: MealPlanService) {}

  @Get()
  findRange(
    @CurrentUser() user: AuthUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.findRange(user.userId, from, to);
  }

  @Get('nutrition')
  nutrition(
    @CurrentUser() user: AuthUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.aggregateNutrition(user.userId, from, to);
  }

  @Post()
  upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertMealPlanDto) {
    return this.service.upsert(user.userId, dto);
  }
}
