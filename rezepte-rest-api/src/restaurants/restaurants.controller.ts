import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RestaurantsService } from './restaurants.service';
import { CreateRestaurantDto, UpdateRestaurantDto } from './dto/restaurant.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { Restaurant } from '@shared/interfaces';

@UseGuards(JwtAuthGuard)
@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly service: RestaurantsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<Restaurant[]> {
    return this.service.findAllForUser(user.userId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Restaurant> {
    return this.service.findOne(id, user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRestaurantDto): Promise<Restaurant> {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRestaurantDto,
  ): Promise<Restaurant> {
    return this.service.update(id, user.userId, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    return this.service.remove(id, user.userId);
  }
}
