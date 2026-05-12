import { Module } from '@nestjs/common';
import { IngestionModule } from './ingestion.module.js';
import { CuratedSeedProcessor } from './infrastructure/curated-seed.processor.js';

@Module({
  imports: [IngestionModule],
  providers: [CuratedSeedProcessor],
})
export class IngestionWorkerModule {}
