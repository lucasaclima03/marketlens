import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { desc } from 'drizzle-orm';
import {
  createPostgresTestContext,
  type PostgresTestContext,
} from '../../../tests/helpers/postgres-container.js';
import { ingestionFailures } from '../../shared/db/schema/ingestion-failures.js';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';
import { IngestionFailureRepository } from './ingestion-failure.repository.js';

const buildRaw = (): RawPriceObservation => ({
  source_id: 'sefaz-al',
  gtin: '0000000000017',
  source_canonical_description: null,
  raw_description: 'GTIN PLACEHOLDER',
  fiscal_code: '07133311',
  category_gpc_code: '50000000',
  unit_of_measure: 'KG',
  declared_value: 1.99,
  sale_value: 1.49,
  sold_at: new Date('2026-05-11T10:00:00Z'),
  establishment: {
    cnpj: '12345678000100',
    legal_name: 'TEST',
    trade_name: null,
    street: 'X',
    street_number: '1',
    neighborhood: 'Y',
    postal_code: null,
    municipality_ibge_code: '2704302',
    municipality_name: 'MACEIO',
    latitude: null,
    longitude: null,
  },
});

describe('IngestionFailureRepository.record (integration)', () => {
  let ctx: PostgresTestContext;
  let repo: IngestionFailureRepository;

  beforeAll(async () => {
    ctx = await createPostgresTestContext();
    repo = new IngestionFailureRepository(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await ctx.truncateAll();
  });

  it('persists a row with reason, source_id, and the full canonical raw_payload (round-trip)', async () => {
    const raw = buildRaw();
    await repo.record({ source_id: 'sefaz-al', reason: 'gtin_invalid_length', raw_payload: raw });

    const rows = await ctx.db.select().from(ingestionFailures);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(row.source_id).toBe('sefaz-al');
    expect(row.reason).toBe('gtin_invalid_length');
    // Full canonical-payload round-trip: every top-level field present, nested
    // establishment block intact (per ADR-0001 source-agnostic guarantee).
    const payload = row.raw_payload as Record<string, unknown> & {
      establishment: Record<string, unknown>;
    };
    expect(payload.source_id).toBe('sefaz-al');
    expect(payload.gtin).toBe('0000000000017');
    expect(payload.source_canonical_description).toBeNull();
    expect(payload.raw_description).toBe('GTIN PLACEHOLDER');
    expect(payload.fiscal_code).toBe('07133311');
    expect(payload.category_gpc_code).toBe('50000000');
    expect(payload.unit_of_measure).toBe('KG');
    expect(payload.declared_value).toBe(1.99);
    expect(payload.sale_value).toBe(1.49);
    expect(payload.sold_at).toBe('2026-05-11T10:00:00.000Z'); // Date → ISO string under JSON serialization
    expect(payload.establishment.cnpj).toBe('12345678000100');
    expect(payload.establishment.municipality_ibge_code).toBe('2704302');
  });

  it('persists multiple failures and exposes them ordered by occurred_at desc', async () => {
    const raw = buildRaw();
    await repo.record({ source_id: 'sefaz-al', reason: 'gtin_invalid_length', raw_payload: raw });
    await repo.record({
      source_id: 'sefaz-al',
      reason: 'sale_value_out_of_range',
      raw_payload: raw,
    });

    const rows = await ctx.db
      .select()
      .from(ingestionFailures)
      .orderBy(desc(ingestionFailures.occurred_at));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.reason)).toContain('gtin_invalid_length');
    expect(rows.map((r) => r.reason)).toContain('sale_value_out_of_range');
  });
});
