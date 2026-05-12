import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  createPostgresTestContext,
  type PostgresTestContext,
} from '../../../tests/helpers/postgres-container.js';
import { establishments } from '../../shared/db/schema/establishments.js';
import { priceObservations } from '../../shared/db/schema/price-observations.js';
import { products } from '../../shared/db/schema/products.js';
import { PriceObservationRepository } from './price-observation.repository.js';

describe('PriceObservationRepository.persist (integration, SCD Type 2)', () => {
  let ctx: PostgresTestContext;
  let repo: PriceObservationRepository;
  let productId: string;
  let establishmentId: string;

  beforeAll(async () => {
    ctx = await createPostgresTestContext();
    repo = new PriceObservationRepository(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await ctx.truncateAll();
    const [p] = await ctx.db
      .insert(products)
      .values({
        gtin: '7894900011517',
        fallback_hash: null,
        canonical_description: 'REFRIGERANTE COCA-COLA GARRAFA 2L',
        fiscal_code: '22021000',
        category_gpc_code: '50000000',
      })
      .returning();
    const [e] = await ctx.db
      .insert(establishments)
      .values({
        cnpj: '12345678000100',
        legal_name: 'SUPERMERCADO ALFA LTDA',
        trade_name: null,
        street: null,
        street_number: null,
        neighborhood: 'FAROL',
        postal_code: null,
        municipality_ibge_code: '2704302',
        municipality_name: 'MACEIO',
        latitude: null,
        longitude: null,
        chain_id: null,
      })
      .returning();
    if (!p || !e) throw new Error('seed failed');
    productId = p.id;
    establishmentId = e.id;
  });

  const baseInput = () => ({
    product_id: productId,
    establishment_id: establishmentId,
    declared_value: 9.99,
    sale_value: 8.49,
    sold_at: new Date('2026-05-11T10:00:00Z'),
    source_id: 'sefaz-al',
  });

  it('Case A — first observation: inserts a new row, outcome=first_observation', async () => {
    const result = await repo.persist(baseInput());
    expect(result.outcome).toBe('first_observation');
    expect(result.observation.declared_value).toBe('9.99');
    expect(result.observation.sale_value).toBe('8.49');

    const rows = await ctx.db.select().from(priceObservations);
    expect(rows).toHaveLength(1);
  });

  it('Case B — extended: identical re-persist updates last_seen_at only', async () => {
    const first = await repo.persist(baseInput());
    const firstFetchedAt = first.observation.fetched_at;
    const firstLastSeenAt = first.observation.last_seen_at;

    await new Promise((r) => setTimeout(r, 25));

    const second = await repo.persist(baseInput());
    expect(second.outcome).toBe('extended');
    expect(second.observation.id).toBe(first.observation.id);
    expect(second.observation.fetched_at.getTime()).toBe(firstFetchedAt.getTime());
    expect(second.observation.last_seen_at.getTime()).toBeGreaterThan(firstLastSeenAt.getTime());

    const rows = await ctx.db.select().from(priceObservations);
    expect(rows).toHaveLength(1);
  });

  it('Case C — price_change: different sale_value closes old row and inserts new current row', async () => {
    const first = await repo.persist(baseInput());
    await new Promise((r) => setTimeout(r, 25));
    const second = await repo.persist({ ...baseInput(), sale_value: 7.99 });
    expect(second.outcome).toBe('price_change');
    expect(second.observation.id).not.toBe(first.observation.id);

    // Inspect closed row (valid_until set to a real timestamp) via SQL predicate
    // rather than reading the column as a Date — current rows may surface as
    // the literal Infinity.
    const closedRows = await ctx.db
      .select()
      .from(priceObservations)
      .where(sql`valid_until <> 'infinity'::timestamptz`);
    expect(closedRows).toHaveLength(1);
    expect(closedRows[0]?.id).toBe(first.observation.id);

    const currentRows = await ctx.db
      .select()
      .from(priceObservations)
      .where(sql`valid_until = 'infinity'::timestamptz`);
    expect(currentRows).toHaveLength(1);
    expect(currentRows[0]?.id).toBe(second.observation.id);
    expect(currentRows[0]?.sale_value).toBe('7.99');
  });

  it('Case C — different declared_value also produces price_change', async () => {
    await repo.persist(baseInput());
    const second = await repo.persist({ ...baseInput(), declared_value: 10.99 });
    expect(second.outcome).toBe('price_change');
  });

  it('Case C — different sold_at also produces price_change', async () => {
    await repo.persist(baseInput());
    const second = await repo.persist({
      ...baseInput(),
      sold_at: new Date('2026-05-11T11:00:00Z'),
    });
    expect(second.outcome).toBe('price_change');
  });

  it('current-row partial unique index guarantees exactly one current row per (product, establishment)', async () => {
    await repo.persist(baseInput());
    await repo.persist({ ...baseInput(), sale_value: 7.99 });
    await repo.persist({ ...baseInput(), sale_value: 6.99 });

    const current = await ctx.db
      .select()
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.product_id, productId),
          eq(priceObservations.establishment_id, establishmentId),
          sql`valid_until = 'infinity'::timestamptz`,
        ),
      );
    expect(current).toHaveLength(1);
    expect(current[0]?.sale_value).toBe('6.99');
  });

  it('different establishments under the same product produce distinct current rows', async () => {
    await repo.persist(baseInput());

    const [e2] = await ctx.db
      .insert(establishments)
      .values({
        cnpj: '98765432000199',
        legal_name: 'MERCADO BETA EIRELI',
        trade_name: null,
        street: null,
        street_number: null,
        neighborhood: 'PONTA VERDE',
        postal_code: null,
        municipality_ibge_code: '2704302',
        municipality_name: 'MACEIO',
        latitude: null,
        longitude: null,
        chain_id: null,
      })
      .returning();
    if (!e2) throw new Error('seed failed');

    const second = await repo.persist({ ...baseInput(), establishment_id: e2.id });
    expect(second.outcome).toBe('first_observation');

    const current = await ctx.db
      .select()
      .from(priceObservations)
      .where(sql`valid_until = 'infinity'::timestamptz`);
    expect(current).toHaveLength(2);
  });
});
