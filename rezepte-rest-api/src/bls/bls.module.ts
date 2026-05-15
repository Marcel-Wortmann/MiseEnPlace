import { Module } from '@nestjs/common';
import { BlsService } from './bls.service';
import { BlsImporterService } from './bls-importer.service';

@Module({
  providers: [BlsService, BlsImporterService],
  exports: [BlsService],
})
export class BlsModule {}
