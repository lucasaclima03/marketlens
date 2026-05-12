import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPostgresTestContext,
  type PostgresTestContext,
} from '../../../tests/helpers/postgres-container.js';
import { ProductRepository } from './product.repository.js';

describe('ProductRepository.findOrCreateByGtin (integration)', () => {
  let ctx: PostgresTestContext;
  let repo: ProductRepository;

  beforeAll(async () => {
    ctx = await createPostgresTestContext();
    repo = new ProductRepository(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await ctx.truncateAll();
  });

  it('creates a product when the GTIN is absent', async () => {
    const product = await repo.findOrCreateByGtin('7894900011517', () => ({
      canonical_description: 'REFRIGERANTE COCA-COLA GARRAFA 2L',
      fiscal_code: '22021000',
      category_gpc_code: '50000000',
    }));

    expect(product.gtin).toBe('7894900011517');
    expect(product.canonical_description).toBe('REFRIGERANTE COCA-COLA GARRAFA 2L');
    expect(product.fiscal_code).toBe('22021000');
  });

  it('returns the existing product when the GTIN is already present', async () => {
    const first = await repo.findOrCreateByGtin('7894900011517', () => ({
      canonical_description: 'first',
      fiscal_code: '22021000',
      category_gpc_code: '50000000',
    }));

    const second = await repo.findOrCreateByGtin('7894900011517', () => {
      throw new Error('fillFn should not be called when the product already exists');
    });

    expect(second.id).toBe(first.id);
    expect(second.canonical_description).toBe('first');
  });

  it('persists distinct rows for different GTINs', async () => {
    const a = await repo.findOrCreateByGtin('7894900011517', () => ({
      canonical_description: 'A',
      fiscal_code: '22021000',
      category_gpc_code: '50000000',
    }));
    const b = await repo.findOrCreateByGtin('40170725', () => ({
      canonical_description: 'B',
      fiscal_code: '21069090',
      category_gpc_code: '50000000',
    }));
    expect(a.id).not.toBe(b.id);
  });
});
