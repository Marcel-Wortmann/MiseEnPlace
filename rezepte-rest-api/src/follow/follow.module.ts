import { Module } from '@nestjs/common';
import { FollowController } from './follow.controller';
import { FollowService } from './follow.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { RecipesModule } from '../recipes/recipes.module';

@Module({
  imports: [PrismaModule, AuthModule, RecipesModule],
  controllers: [FollowController],
  providers: [FollowService],
})
export class FollowModule {}
