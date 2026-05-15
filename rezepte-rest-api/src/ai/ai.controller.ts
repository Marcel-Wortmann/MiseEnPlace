import {
  Body,
  Controller,
  Inject,
  Logger,
  Post,
  forwardRef,
} from '@nestjs/common';
import { VoiceCommandService } from './voice-command.service';
import { VoiceCommandDto, VoiceCommandResult } from './dto/voice-command.dto';
import { TagSuggesterService } from './tag-suggester.service';
import { SuggestTagsDto } from './dto/suggest-tags.dto';
import { SuggestRestaurantTagsDto } from './dto/suggest-restaurant-tags.dto';
import { RecipesService } from '../recipes/recipes.service';
import { CalorieEstimatorService } from './calorie-estimator.service';
import { EstimateCaloriesDto } from './dto/ai.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { CaloriesEstimate } from '@shared/interfaces/recipe.interface';

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly estimator: CalorieEstimatorService,
    private readonly voiceService: VoiceCommandService,
    private readonly tagSuggester: TagSuggesterService,
    @Inject(forwardRef(() => RecipesService))
    private readonly recipesService: RecipesService,
  ) {}

  @Post('estimate-calories')
  async estimateCalories(
    @CurrentUser() user: AuthUser,
    @Body() dto: EstimateCaloriesDto,
  ): Promise<CaloriesEstimate> {
    const ingredients = dto.ingredients.map((i) => ({
      name: i.name,
      amount: i.amount ?? null,
      unit: i.unit ?? null,
    }));
    return this.estimator.estimate(user.userId, ingredients, dto.servings ?? null, dto.title);
  }

  @Post('voice-command')
  async voiceCommand(@Body() dto: VoiceCommandDto): Promise<VoiceCommandResult> {
    return this.voiceService.interpret(dto);
  }

  @Post('suggest-tags')
  async suggestTags(
    @CurrentUser() user: AuthUser,
    @Body() dto: SuggestTagsDto,
  ): Promise<{ tags: string[] }> {
    const tags = await this.tagSuggester.suggest({
      title: dto.title,
      description: dto.description ?? null,
      ingredients: dto.ingredients,
      steps: dto.steps,
      existingTags: await this.recipesService.getAllTagsForUser(user.userId),
      durationMinutes: dto.durationMinutes ?? null,
    });
    return { tags };
  }

  @Post('suggest-restaurant-tags')
  async suggestRestaurantTags(@Body() dto: SuggestRestaurantTagsDto): Promise<{ tags: string[] }> {
    const tags = await this.tagSuggester.suggestRestaurant({
      name: dto.name,
      cuisine: dto.cuisine ?? null,
      notes: dto.notes ?? null,
      existingTags: [],
    });
    return { tags };
  }
}
