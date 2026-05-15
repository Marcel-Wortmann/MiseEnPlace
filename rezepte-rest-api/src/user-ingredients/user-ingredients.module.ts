import { Module } from '@nestjs/common';
import { UserIngredientsController } from './user-ingredients.controller';
import { UserIngredientsService } from './user-ingredients.service';
import { OpenFoodFactsModule } from '../openfoodfacts/openfoodfacts.module';

@Module({
  imports: [OpenFoodFactsModule],
  controllers: [UserIngredientsController],
  providers: [UserIngredientsService],
  exports: [UserIngredientsService],
})
export class UserIngredientsModule {}
