import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPostgresTestContext,
  type PostgresTestContext,
} from '../../../tests/helpers/postgres-container.js';
import { EstablishmentRepository } from './establishment.repository.js';

const fillFromRaw = () => ({
  legal_name: 'SUPERMERCADO ALFA LTDA',
  trade_name: 'ALFA SUPER',
  street: 'AV FERNANDES LIMA',
  street_number: '1500',
  neighborhood: 'FAROL',
  postal_code: '57051000',
  municipality_ibge_code: '2704302',
  municipality_name: 'MACEIO',
  latitude: -9.6498,
  longitude: -35.7378,
});

describe('EstablishmentRepository.findOrCreateByCnpj (integration)', () => {
  let ctx: PostgresTestContext;
  let repo: EstablishmentRepository;

  beforeAll(async () => {
    ctx = await createPostgresTestContext();
    repo = new EstablishmentRepository(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await ctx.truncateAll();
  });

  it('creates an establishment when the CNPJ is absent', async () => {
    const est = await repo.findOrCreateByCnpj('12345678000100', fillFromRaw);
    expect(est.cnpj).toBe('12345678000100');
    expect(est.cnpj_root).toBe('12345678');
    expect(est.legal_name).toBe('SUPERMERCADO ALFA LTDA');
    expect(est.municipality_ibge_code).toBe('2704302');
    expect(est.chain_id).toBeNull();
  });

  it('returns the existing establishment when the CNPJ is already present', async () => {
    const first = await repo.findOrCreateByCnpj('12345678000100', fillFromRaw);
    const second = await repo.findOrCreateByCnpj('12345678000100', () => {
      throw new Error('fillFn should not be called when the establishment already exists');
    });
    expect(second.id).toBe(first.id);
  });

  it('persists lat=0 and lng=0 verbatim (data-quality case; quality_flag populated in M3)', async () => {
    const est = await repo.findOrCreateByCnpj('11111111000111', () => ({
      ...fillFromRaw(),
      legal_name: 'SUPER VAREJO ATACADO LTDA',
      trade_name: null,
      latitude: 0,
      longitude: 0,
    }));
    expect(est.latitude).toBe(0);
    expect(est.longitude).toBe(0);
  });
});
