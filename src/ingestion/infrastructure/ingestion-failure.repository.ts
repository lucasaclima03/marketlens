import { Inject, Injectable } from '@nestjs/common';
import type { AppDatabase } from '../../shared/db/client.js';
import { DATABASE } from '../../shared/db/db.module.js';
import { ingestionFailures } from '../../shared/db/schema/ingestion-failures.js';
import type { HardRejectionReason } from '../domain/hard-rejection.js';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';

export interface IngestionFailureRecord {
  readonly source_id: string;
  readonly reason: HardRejectionReason;
  readonly raw_payload: RawPriceObservation;
}

@Injectable()
export class IngestionFailureRepository {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}

  async record(input: IngestionFailureRecord): Promise<void> {
    await this.db.insert(ingestionFailures).values({
      source_id: input.source_id,
      reason: input.reason,
      raw_payload: input.raw_payload,
    });
  }
}
