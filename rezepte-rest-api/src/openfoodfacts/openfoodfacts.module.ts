import { Module } from '@nestjs/common';
import { OpenFoodFactsService } from './openfoodfacts.service';

@Module({
  providers: [OpenFoodFactsService],
  exports: [OpenFoodFactsService],
})
export class OpenFoodFactsModule {}
