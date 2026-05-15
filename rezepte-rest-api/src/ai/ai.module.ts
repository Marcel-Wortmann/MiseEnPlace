import { Module, forwardRef } from '@nestjs/common';
import { AiController } from './ai.controller';
import { OllamaService } from './ollama.service';
import { RecipeExtractorService } from './recipe-extractor.service';
import { CalorieEstimatorService } from './calorie-estimator.service';
import { VoiceCommandService } from './voice-command.service';
import { TagSuggesterService } from './tag-suggester.service';
import { BlsModule } from '../bls/bls.module';
import { UserIngredientsModule } from '../user-ingredients/user-ingredients.module';
import { RecipesModule } from '../recipes/recipes.module';

@Module({
  imports: [BlsModule, UserIngredientsModule, forwardRef(() => RecipesModule)],
  controllers: [AiController],
  providers: [OllamaService, RecipeExtractorService, CalorieEstimatorService, VoiceCommandService, TagSuggesterService],
  exports: [OllamaService, RecipeExtractorService],
})
export class AiModule {}
