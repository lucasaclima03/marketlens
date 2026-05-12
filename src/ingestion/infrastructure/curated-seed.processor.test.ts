import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { IngestionService } from '../application/ingestion.service.js';
import { CuratedSeedProcessor, type CuratedSeedJobData } from './curated-seed.processor.js';

describe('CuratedSeedProcessor.process', () => {
  it('delegates to IngestionService.ingest with the job payload and returns the result', async () => {
    const ingest = vi.fn().mockResolvedValue({
      fetched: 2,
      persisted: 2,
      extended: 0,
      rejected: 0,
      skipped: 0,
    });
    const ingestion = { ingest } as unknown as IngestionService;

    const processor = new CuratedSeedProcessor(ingestion);
    const fakeJob = {
      id: 'curated-seed:7894900011517:2704302:2026-05-12T12',
      data: { gtin: '7894900011517', municipalityIbgeCode: '2704302' },
    } as Job<CuratedSeedJobData>;

    const result = await processor.process(fakeJob);

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith({
      gtin: '7894900011517',
      municipalityIbgeCode: '2704302',
    });
    expect(result).toEqual({
      fetched: 2,
      persisted: 2,
      extended: 0,
      rejected: 0,
      skipped: 0,
    });
  });
});
