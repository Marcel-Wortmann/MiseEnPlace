import { Module, forwardRef } from '@nestjs/common';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './recipes.service';
import { UploadModule } from '../upload/upload.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [UploadModule, forwardRef(() => AiModule)],
  controllers: [RecipesController],
  providers: [RecipesService],
  exports: [RecipesService],
})
export class RecipesModule {}
