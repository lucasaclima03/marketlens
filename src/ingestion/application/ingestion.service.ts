import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SefazAlAdapter } from '../../sources/sefaz-al/sefaz-al.adapter.js';
import { SefazAlClient } from '../../sources/sefaz-al/sefaz-al.client.js';
import type { SefazAlPriceItem } from '../../sources/sefaz-al/sefaz-al.schemas.js';
import {
  EVENT_INGESTION_REJECTED,
  EVENT_PRICE_OBSERVATION_CREATED,
  EVENT_PRICE_OBSERVATION_EXTENDED,
} from '../domain/events.js';
import type { HardRejection } from '../domain/hard-rejection.js';
import { emptyIngestionResult, type IngestionResult } from '../domain/ingestion-result.js';
import type { JobContext } from '../domain/job-context.js';
import type { PersistResult } from '../infrastructure/price-observation.repository.js';
import { IngestionPipeline } from './ingestion-pipeline.js';
import type { NormalizationResult } from './normalization.service.js';

export interface IngestionQuery {
  readonly gtin: string;
  readonly municipalityIbgeCode: string;
}

@Injectable()
export class IngestionService {
  constructor(
    private readonly client: SefazAlClient,
    private readonly adapter: SefazAlAdapter,
    private readonly pipeline: IngestionPipeline,
    private readonly events: EventEmitter2,
  ) {}

  async ingest(query: IngestionQuery): Promise<IngestionResult> {
    const response = await this.client.fetch(query);
    const jobContext: JobContext = { kind: 'curated_seed', queriedGtin: query.gtin };

    let acc: IngestionResult = { ...emptyIngestionResult(), fetched: response.conteudo.length };
    for (const item of response.conteudo) {
      acc = await this.processOne(item, jobContext, acc);
    }
    return acc;
  }

  private async processOne(
    item: SefazAlPriceItem,
    jobContext: JobContext,
    acc: IngestionResult,
  ): Promise<IngestionResult> {
    const raw = this.adapter.adapt(item);
    const validated = this.pipeline.validator.validate(raw);

    if (!validated.ok) {
      await this.recordRejection(validated.error);
      return { ...acc, rejected: acc.rejected + 1 };
    }

    const normalized = await this.pipeline.normalization.normalize(validated.value, jobContext);
    if (normalized.skipped) {
      return { ...acc, skipped: acc.skipped + 1 };
    }

    const persisted = await this.pipeline.priceRepo.persist({
      product_id: normalized.data.product_id,
      establishment_id: normalized.data.establishment_id,
      declared_value: normalized.data.declared_value,
      sale_value: normalized.data.sale_value,
      sold_at: normalized.data.sold_at,
      source_id: normalized.data.source_id,
    });

    this.emitPersistEvent(persisted, normalized);
    return persisted.outcome === 'extended'
      ? { ...acc, extended: acc.extended + 1 }
      : { ...acc, persisted: acc.persisted + 1 };
  }

  private async recordRejection(rejection: HardRejection): Promise<void> {
    await this.pipeline.failureRepo.record({
      source_id: rejection.raw_payload.source_id,
      reason: rejection.reason,
      raw_payload: rejection.raw_payload,
    });
    this.events.emit(EVENT_INGESTION_REJECTED, {
      source_id: rejection.raw_payload.source_id,
      reason: rejection.reason,
      raw_payload: rejection.raw_payload,
    });
  }

  private emitPersistEvent(
    result: PersistResult,
    normalized: Extract<NormalizationResult, { skipped: false }>,
  ): void {
    const base = {
      observation_id: result.observation.id,
      product_id: normalized.data.product_id,
      establishment_id: normalized.data.establishment_id,
      source_id: normalized.data.source_id,
    };
    if (result.outcome === 'extended') {
      this.events.emit(EVENT_PRICE_OBSERVATION_EXTENDED, base);
    } else {
      this.events.emit(EVENT_PRICE_OBSERVATION_CREATED, { ...base, kind: result.outcome });
    }
  }
}
