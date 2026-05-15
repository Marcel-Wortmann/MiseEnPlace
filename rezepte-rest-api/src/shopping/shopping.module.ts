import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShoppingController } from './shopping.controller';
import { ShoppingService } from './shopping.service';
import { RecipesModule } from '../recipes/recipes.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, RecipesModule, AuthModule],
  controllers: [ShoppingController],
  providers: [ShoppingService],
})
export class ShoppingModule {}
