import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { ThumbPrewarmerService } from './thumb-prewarmer.service';

@Module({
  controllers: [UploadController],
  providers: [UploadService, ThumbPrewarmerService],
  exports: [UploadService],
})
export class UploadModule {}
