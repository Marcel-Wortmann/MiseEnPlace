import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { RecipeIdeasService } from './recipe-ideas.service';
import { CreateRecipeIdeaDto } from './dto/create-recipe-idea.dto';
import { UpdateRecipeIdeaDto } from './dto/update-recipe-idea.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { RecipeIdea } from '@shared/interfaces/recipe-idea.interface';

@Controller('recipe-ideas')
export class RecipeIdeasController {
  constructor(private readonly service: RecipeIdeasService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser): Promise<RecipeIdea[]> {
    return this.service.findAllForUser(user.userId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RecipeIdea> {
    return this.service.findOneForUser(id, user.userId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRecipeIdeaDto,
  ): Promise<RecipeIdea> {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecipeIdeaDto,
  ): Promise<RecipeIdea> {
    return this.service.update(id, user.userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(id, user.userId);
  }
}
