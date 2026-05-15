import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { WinesService } from './wines.service';
import { CreateWineDto } from './dto/create-wine.dto';
import { UpdateWineDto } from './dto/update-wine.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { Wine } from '@shared/interfaces/wine.interface';

@Controller('wines')
export class WinesController {
  constructor(private readonly service: WinesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser): Promise<Wine[]> {
    return this.service.findAllForUser(user.userId);
  }

  @Get(':id')
  findById(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Wine> {
    return this.service.findByIdForUser(id, user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWineDto): Promise<Wine> {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateWineDto,
  ): Promise<Wine> {
    return this.service.update(id, user.userId, dto);
  }

  @Post(':id/retry-analysis')
  retryAnalysis(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Wine> {
    return this.service.retryAnalysis(id, user.userId);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.service.remove(id, user.userId);
  }
}
