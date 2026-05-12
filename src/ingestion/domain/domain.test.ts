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

describe('Result', () => {
  it('ok() wraps a value with ok:true', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('err() wraps an error with ok:false', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });

  it('ok() preserves reference identity of the wrapped value', () => {
    const payload = { nested: { deep: true } };
    const result = ok(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(payload);
    }
  });

  it('err() preserves reference identity of the wrapped error', () => {
    const cause = new Error('downstream');
    const result = err(cause);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(cause);
    }
  });

  it('ok() accepts falsy values without treating them as absence', () => {
    expect(ok(0)).toEqual({ ok: true, value: 0 });
    expect(ok(false)).toEqual({ ok: true, value: false });
    expect(ok('')).toEqual({ ok: true, value: '' });
    expect(ok(null)).toEqual({ ok: true, value: null });
    expect(ok(undefined)).toEqual({ ok: true, value: undefined });
  });

  it('ok() result carries no "error" key (clean discriminator)', () => {
    const result = ok(1);
    expect('error' in result).toBe(false);
  });

  it('err() result carries no "value" key (clean discriminator)', () => {
    const result = err('x');
    expect('value' in result).toBe(false);
  });
});

describe('HardRejection', () => {
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

  it('HARD_REJECTION_REASONS lists the closed enum (exactly 3 reasons, in declared order)', () => {
    expect(HARD_REJECTION_REASONS).toEqual([
      'gtin_invalid_length',
      'gtin_invalid_check_digit',
      'sale_value_out_of_range',
    ]);
    expect(HARD_REJECTION_REASONS).toHaveLength(3);
  });

  it.each(HARD_REJECTION_REASONS)('hardRejection() accepts reason %s', (reason) => {
    const rejection = hardRejection(reason, sampleRaw);
    expect(rejection.reason).toBe(reason);
    expect(rejection.raw_payload).toBe(sampleRaw);
  });

  it('hardRejection() preserves reference identity of the raw_payload (no defensive clone)', () => {
    const rejection = hardRejection('gtin_invalid_length', sampleRaw);
    expect(rejection.raw_payload).toBe(sampleRaw);
    expect(rejection.raw_payload.establishment).toBe(sampleRaw.establishment);
    expect(rejection.raw_payload.sold_at).toBe(sampleRaw.sold_at);
  });
});

describe('IngestionResult', () => {
  it('emptyIngestionResult() returns all five counters at zero', () => {
    expect(emptyIngestionResult()).toEqual({
      fetched: 0,
      persisted: 0,
      extended: 0,
      rejected: 0,
      skipped: 0,
    });
  });

  it('emptyIngestionResult() returns a fresh object on every call (not a shared singleton)', () => {
    const a = emptyIngestionResult();
    const b = emptyIngestionResult();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('mutating one IngestionResult does not bleed into a later call', () => {
    const first = emptyIngestionResult() as { fetched: number };
    first.fetched = 999;
    const second = emptyIngestionResult();
    expect(second.fetched).toBe(0);
  });
});

describe('events', () => {
  it('exposes the three domain event names as constants', () => {
    expect(EVENT_PRICE_OBSERVATION_CREATED).toBe('price_observation.created');
    expect(EVENT_PRICE_OBSERVATION_EXTENDED).toBe('price_observation.extended');
    expect(EVENT_INGESTION_REJECTED).toBe('ingestion.rejected');
  });

  it('event names are pairwise distinct (no copy-paste collisions)', () => {
    const names = new Set([
      EVENT_PRICE_OBSERVATION_CREATED,
      EVENT_PRICE_OBSERVATION_EXTENDED,
      EVENT_INGESTION_REJECTED,
    ]);
    expect(names.size).toBe(3);
  });
});

describe('JobContext', () => {
  it('discriminates curated_seed from discovery via the kind tag', () => {
    const curated: JobContext = { kind: 'curated_seed', queriedGtin: '07891000100103' };
    const discovery: JobContext = { kind: 'discovery' };
    expect(curated.kind).toBe('curated_seed');
    expect(discovery.kind).toBe('discovery');
  });

  it('discovery JobContext carries no queriedGtin at runtime', () => {
    const discovery: JobContext = { kind: 'discovery' };
    expect('queriedGtin' in discovery).toBe(false);
  });
});
