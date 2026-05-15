import { Module } from '@nestjs/common';
import { WinesController } from './wines.controller';
import { WinesService } from './wines.service';
import { WineAnalyzerService } from './wine-analyzer.service';
import { TavilyService } from './tavily.service';
import { AiModule } from '../ai/ai.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [AiModule, UploadModule],
  controllers: [WinesController],
  providers: [WinesService, WineAnalyzerService, TavilyService],
})
export class WinesModule {}
