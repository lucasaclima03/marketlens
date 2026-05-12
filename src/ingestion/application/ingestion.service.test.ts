import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { SefazAlClient } from '../../sources/sefaz-al/sefaz-al.client.js';
import type {
  SefazAlPriceItem,
  SefazAlPriceResponse,
} from '../../sources/sefaz-al/sefaz-al.schemas.js';
import {
  EVENT_INGESTION_REJECTED,
  EVENT_PRICE_OBSERVATION_CREATED,
  EVENT_PRICE_OBSERVATION_EXTENDED,
} from '../domain/events.js';
import { hardRejection } from '../domain/hard-rejection.js';
import { err, ok } from '../domain/result.js';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';
import { IngestionPipeline } from './ingestion-pipeline.js';
import { IngestionService } from './ingestion.service.js';

// Placeholder item — the adapter is mocked, so the orchestrator never reads
// the inner shape; only the count and identity of items matter.
const buildItem = (gtin: string): SefazAlPriceItem =>
  ({
    produto: { gtin } as unknown,
    estabelecimento: {} as unknown,
  }) as unknown as SefazAlPriceItem;

const buildRaw = (gtin: string, sale: number): RawPriceObservation => ({
  source_id: 'sefaz-al',
  gtin,
  source_canonical_description: null,
  raw_description: 'X',
  fiscal_code: '22021000',
  category_gpc_code: '50000000',
  unit_of_measure: 'UN',
  declared_value: sale + 1,
  sale_value: sale,
  sold_at: new Date('2026-05-11T10:00:00Z'),
  establishment: {
    cnpj: '12345678000100',
    legal_name: 'X',
    trade_name: null,
    street: null,
    street_number: null,
    neighborhood: 'X',
    postal_code: null,
    municipality_ibge_code: '2704302',
    municipality_name: 'MACEIO',
    latitude: null,
    longitude: null,
  },
});

const buildResponse = (items: SefazAlPriceItem[]): SefazAlPriceResponse => ({
  conteudo: items,
  pagina: 1,
  primeiraPagina: true,
  registrosPagina: items.length,
  registrosPorPagina: 100,
  totalPaginas: 1,
  totalRegistros: items.length,
  ultimaPagina: true,
});

describe('IngestionService.ingest', () => {
  let client: { fetch: ReturnType<typeof vi.fn> };
  let adapter: { adapt: ReturnType<typeof vi.fn> };
  let validator: { validate: ReturnType<typeof vi.fn> };
  let normalization: { normalize: ReturnType<typeof vi.fn> };
  let priceRepo: { persist: ReturnType<typeof vi.fn> };
  let failureRepo: { record: ReturnType<typeof vi.fn> };
  let pipeline: IngestionPipeline;
  let events: { emit: ReturnType<typeof vi.fn> };
  let svc: IngestionService;

  beforeEach(() => {
    client = { fetch: vi.fn() };
    adapter = { adapt: vi.fn() };
    validator = { validate: vi.fn() };
    normalization = { normalize: vi.fn() };
    priceRepo = { persist: vi.fn() };
    failureRepo = { record: vi.fn().mockResolvedValue(undefined) };
    events = { emit: vi.fn() };
    pipeline = {
      validator,
      normalization,
      priceRepo,
      failureRepo,
    } as unknown as IngestionPipeline;
    svc = new IngestionService(
      client as unknown as SefazAlClient,
      adapter,
      pipeline,
      events as unknown as EventEmitter2,
    );
  });

  it('returns all-zero result for an empty response', async () => {
    client.fetch.mockResolvedValue(buildResponse([]));
    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });
    expect(result).toEqual({
      fetched: 0,
      persisted: 0,
      extended: 0,
      rejected: 0,
      skipped: 0,
    });
  });

  it('persists two first_observations and emits two PriceObservationCreated events', async () => {
    const item1 = buildItem('7894900011517');
    const item2 = buildItem('7894900011517');
    const raw1 = buildRaw('7894900011517', 8.49);
    const raw2 = buildRaw('7894900011517', 8.99);
    client.fetch.mockResolvedValue(buildResponse([item1, item2]));
    adapter.adapt.mockReturnValueOnce(raw1).mockReturnValueOnce(raw2);
    validator.validate.mockImplementation(ok);
    normalization.normalize
      .mockResolvedValueOnce({
        skipped: false,
        data: {
          product_id: 'p-1',
          establishment_id: 'e-1',
          declared_value: 9.49,
          sale_value: 8.49,
          sold_at: raw1.sold_at,
          source_id: 'sefaz-al',
        },
      })
      .mockResolvedValueOnce({
        skipped: false,
        data: {
          product_id: 'p-1',
          establishment_id: 'e-2',
          declared_value: 9.99,
          sale_value: 8.99,
          sold_at: raw2.sold_at,
          source_id: 'sefaz-al',
        },
      });
    priceRepo.persist
      .mockResolvedValueOnce({ observation: { id: 'o-1' }, outcome: 'first_observation' })
      .mockResolvedValueOnce({ observation: { id: 'o-2' }, outcome: 'first_observation' });

    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });

    expect(result).toEqual({
      fetched: 2,
      persisted: 2,
      extended: 0,
      rejected: 0,
      skipped: 0,
    });
    expect(events.emit).toHaveBeenCalledWith(
      EVENT_PRICE_OBSERVATION_CREATED,
      expect.objectContaining({ observation_id: 'o-1', kind: 'first_observation' }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      EVENT_PRICE_OBSERVATION_CREATED,
      expect.objectContaining({ observation_id: 'o-2', kind: 'first_observation' }),
    );
  });

  it('records HardRejection in ingestion_failures and emits IngestionRejected', async () => {
    const item = buildItem('0000000000017');
    const raw = buildRaw('0000000000017', 1.99);
    client.fetch.mockResolvedValue(buildResponse([item]));
    adapter.adapt.mockReturnValue(raw);
    validator.validate.mockReturnValue(err(hardRejection('gtin_invalid_length', raw)));

    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });

    expect(result).toEqual({
      fetched: 1,
      persisted: 0,
      extended: 0,
      rejected: 1,
      skipped: 0,
    });
    expect(failureRepo.record).toHaveBeenCalledWith({
      source_id: 'sefaz-al',
      reason: 'gtin_invalid_length',
      raw_payload: raw,
    });
    expect(events.emit).toHaveBeenCalledWith(
      EVENT_INGESTION_REJECTED,
      expect.objectContaining({ reason: 'gtin_invalid_length', source_id: 'sefaz-al' }),
    );
    expect(normalization.normalize).not.toHaveBeenCalled();
    expect(priceRepo.persist).not.toHaveBeenCalled();
  });

  it('skipped item (cross_pollution) increments only the skipped counter and emits no event', async () => {
    const item = buildItem('9999999999999');
    const raw = buildRaw('9999999999999', 5.0);
    client.fetch.mockResolvedValue(buildResponse([item]));
    adapter.adapt.mockReturnValue(raw);
    validator.validate.mockReturnValue(ok(raw));
    normalization.normalize.mockResolvedValue({ skipped: true, reason: 'cross_pollution' });

    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });

    expect(result).toEqual({
      fetched: 1,
      persisted: 0,
      extended: 0,
      rejected: 0,
      skipped: 1,
    });
    expect(priceRepo.persist).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('extended outcome emits PriceObservationExtended and bumps the extended counter', async () => {
    const item = buildItem('7894900011517');
    const raw = buildRaw('7894900011517', 8.49);
    client.fetch.mockResolvedValue(buildResponse([item]));
    adapter.adapt.mockReturnValue(raw);
    validator.validate.mockReturnValue(ok(raw));
    normalization.normalize.mockResolvedValue({
      skipped: false,
      data: {
        product_id: 'p-1',
        establishment_id: 'e-1',
        declared_value: 9.49,
        sale_value: 8.49,
        sold_at: raw.sold_at,
        source_id: 'sefaz-al',
      },
    });
    priceRepo.persist.mockResolvedValue({ observation: { id: 'o-1' }, outcome: 'extended' });

    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });

    expect(result.extended).toBe(1);
    expect(events.emit).toHaveBeenCalledWith(
      EVENT_PRICE_OBSERVATION_EXTENDED,
      expect.objectContaining({ observation_id: 'o-1' }),
    );
  });

  it('price_change outcome emits PriceObservationCreated with kind=price_change', async () => {
    const item = buildItem('7894900011517');
    const raw = buildRaw('7894900011517', 7.99);
    client.fetch.mockResolvedValue(buildResponse([item]));
    adapter.adapt.mockReturnValue(raw);
    validator.validate.mockReturnValue(ok(raw));
    normalization.normalize.mockResolvedValue({
      skipped: false,
      data: {
        product_id: 'p-1',
        establishment_id: 'e-1',
        declared_value: 8.99,
        sale_value: 7.99,
        sold_at: raw.sold_at,
        source_id: 'sefaz-al',
      },
    });
    priceRepo.persist.mockResolvedValue({ observation: { id: 'o-2' }, outcome: 'price_change' });

    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });

    expect(result.persisted).toBe(1);
    expect(events.emit).toHaveBeenCalledWith(
      EVENT_PRICE_OBSERVATION_CREATED,
      expect.objectContaining({ kind: 'price_change' }),
    );
  });

  it('continues processing remaining items when one rejection occurs mid-loop', async () => {
    const itemGood = buildItem('7894900011517');
    const itemBad = buildItem('0000000000017');
    const rawGood = buildRaw('7894900011517', 8.49);
    const rawBad = buildRaw('0000000000017', 5.0);
    client.fetch.mockResolvedValue(buildResponse([itemBad, itemGood]));
    adapter.adapt.mockReturnValueOnce(rawBad).mockReturnValueOnce(rawGood);
    validator.validate
      .mockReturnValueOnce(err(hardRejection('gtin_invalid_length', rawBad)))
      .mockReturnValueOnce(ok(rawGood));
    normalization.normalize.mockResolvedValue({
      skipped: false,
      data: {
        product_id: 'p-1',
        establishment_id: 'e-1',
        declared_value: 9.49,
        sale_value: 8.49,
        sold_at: rawGood.sold_at,
        source_id: 'sefaz-al',
      },
    });
    priceRepo.persist.mockResolvedValue({
      observation: { id: 'o-good' },
      outcome: 'first_observation',
    });

    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });
    expect(result).toEqual({
      fetched: 2,
      persisted: 1,
      extended: 0,
      rejected: 1,
      skipped: 0,
    });
  });

  it('invariant: fetched = persisted + extended + rejected + skipped', async () => {
    client.fetch.mockResolvedValue(buildResponse([]));
    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });
    expect(result.fetched).toBe(
      result.persisted + result.extended + result.rejected + result.skipped,
    );
  });
});
