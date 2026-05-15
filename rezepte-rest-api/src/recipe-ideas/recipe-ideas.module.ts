import { Module } from '@nestjs/common';
import { RecipeIdeasController } from './recipe-ideas.controller';
import { RecipeIdeasService } from './recipe-ideas.service';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [UploadModule],
  controllers: [RecipeIdeasController],
  providers: [RecipeIdeasService],
})
export class RecipeIdeasModule {}
