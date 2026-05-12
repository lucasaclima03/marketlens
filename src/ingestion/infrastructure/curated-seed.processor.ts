import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_CURATED_SEED } from '../../shared/bullmq/queues.js';
import { IngestionService } from '../application/ingestion.service.js';
import type { IngestionResult } from '../domain/ingestion-result.js';

export interface CuratedSeedJobData {
  readonly gtin: string;
  readonly municipalityIbgeCode: string;
}

@Processor(QUEUE_CURATED_SEED, { concurrency: 2 })
export class CuratedSeedProcessor extends WorkerHost {
  private readonly logger = new Logger(CuratedSeedProcessor.name);

  constructor(private readonly ingestion: IngestionService) {
    super();
  }

  async process(job: Job<CuratedSeedJobData>): Promise<IngestionResult> {
    const jobFields = {
      jobId: job.id,
      gtin: job.data.gtin,
      municipalityIbgeCode: job.data.municipalityIbgeCode,
    };
    this.logger.log({ event: 'curated-seed.start', ...jobFields });
    const result = await this.ingestion.ingest({
      gtin: job.data.gtin,
      municipalityIbgeCode: job.data.municipalityIbgeCode,
    });
    this.logger.log({ event: 'curated-seed.done', ...jobFields, ...result });
    return result;
  }
}
