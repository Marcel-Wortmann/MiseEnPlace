import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { UploadModule } from './upload/upload.module';
import { RecipesModule } from './recipes/recipes.module';
import { RecipeIdeasModule } from './recipe-ideas/recipe-ideas.module';
import { AiModule } from './ai/ai.module';
import { WinesModule } from './wines/wines.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { UsersModule } from './users/users.module';
import { SharesModule } from './shares/shares.module';
import { BlsModule } from './bls/bls.module';
import { UserIngredientsModule } from './user-ingredients/user-ingredients.module';
import { ShoppingModule } from './shopping/shopping.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { MealPlanModule } from './meal-plan/meal-plan.module';
import { FollowModule } from './follow/follow.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Module({
  imports: [
    PrismaModule,
    UploadModule,
    AuthModule,
    AdminModule,
    UsersModule,
    SharesModule,
    BlsModule,
    UserIngredientsModule,
    RecipesModule,
    RecipeIdeasModule,
    AiModule,
    WinesModule,
    ShoppingModule,
    RestaurantsModule,
    MealPlanModule,
    FollowModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
