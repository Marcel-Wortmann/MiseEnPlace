import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [AdminController],
  providers: [AdminGuard],
})
export class AdminModule {}
