import { describe, expect, it } from 'vitest';
import {
  EVENT_INGESTION_REJECTED,
  EVENT_PRICE_OBSERVATION_CREATED,
  EVENT_PRICE_OBSERVATION_EXTENDED,
} from './events.js';
import { HARD_REJECTION_REASONS, hardRejection } from './hard-rejection.js';
import { emptyIngestionResult } from './ingestion-result.js';
import type { JobContext } from './job-context.js';
import type { RawPriceObservation } from './raw-price-observation.js';
import { err, ok } from './result.js';

const sampleRaw: RawPriceObservation = {
  source_id: 'sefaz-al',
  gtin: '07891000100103',
  source_canonical_description: null,
  raw_description: 'LEITE INTEGRAL UHT 1L',
  fiscal_code: '04012010',
  category_gpc_code: '10000045',
  unit_of_measure: 'UN',
  declared_value: 5.49,
  sale_value: 4.99,
  sold_at: new Date('2026-05-10T12:00:00Z'),
  establishment: {
    cnpj: '12345678000199',
    legal_name: 'Mercado Exemplo LTDA',
    trade_name: null,
    street: 'Rua A',
    street_number: '100',
    neighborhood: 'Centro',
    postal_code: '57000000',
    municipality_ibge_code: '2704302',
    municipality_name: 'Maceió',
    latitude: -9.66599,
    longitude: -35.735,
  },
};

describe('Result', () => {
  it('ok() wraps a value with ok:true', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('err() wraps an error with ok:false', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });
});

describe('HardRejection', () => {
  it('hardRejection() builds a rejection with reason and payload', () => {
    const rejection = hardRejection('gtin_invalid_check_digit', sampleRaw);
    expect(rejection.reason).toBe('gtin_invalid_check_digit');
    expect(rejection.raw_payload).toBe(sampleRaw);
  });

  it('HARD_REJECTION_REASONS lists the closed enum', () => {
    expect(HARD_REJECTION_REASONS).toEqual([
      'gtin_invalid_length',
      'gtin_invalid_check_digit',
      'sale_value_out_of_range',
    ]);
  });
});

describe('IngestionResult', () => {
  it('emptyIngestionResult() returns all counters at zero', () => {
    expect(emptyIngestionResult()).toEqual({
      fetched: 0,
      persisted: 0,
      extended: 0,
      rejected: 0,
      skipped: 0,
    });
  });
});

describe('events', () => {
  it('exposes the three domain event names as constants', () => {
    expect(EVENT_PRICE_OBSERVATION_CREATED).toBe('price_observation.created');
    expect(EVENT_PRICE_OBSERVATION_EXTENDED).toBe('price_observation.extended');
    expect(EVENT_INGESTION_REJECTED).toBe('ingestion.rejected');
  });
});

describe('JobContext', () => {
  it('discriminates curated_seed from discovery via the kind tag', () => {
    const curated: JobContext = { kind: 'curated_seed', queriedGtin: '07891000100103' };
    const discovery: JobContext = { kind: 'discovery' };
    expect(curated.kind).toBe('curated_seed');
    expect(discovery.kind).toBe('discovery');
  });
});
