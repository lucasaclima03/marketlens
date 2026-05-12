import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Establishment } from '../../catalog/domain/establishment.js';
import type { Product } from '../../catalog/domain/product.js';
import { EstablishmentRepository } from '../infrastructure/establishment.repository.js';
import { ProductRepository } from '../infrastructure/product.repository.js';
import type { JobContext } from '../domain/job-context.js';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';
import { NormalizationService } from './normalization.service.js';

const stubProduct: Product = {
  id: 'p-1',
  gtin: '7894900011517',
  fallback_hash: null,
  canonical_description: 'REFRIGERANTE COCA-COLA GARRAFA 2L',
  fiscal_code: '22021000',
  category_gpc_code: '50000000',
  created_at: new Date('2026-05-11T00:00:00Z'),
  updated_at: new Date('2026-05-11T00:00:00Z'),
};

const stubEstablishment: Establishment = {
  id: 'e-1',
  cnpj: '12345678000100',
  cnpj_root: '12345678',
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
  created_at: new Date('2026-05-11T00:00:00Z'),
  updated_at: new Date('2026-05-11T00:00:00Z'),
};

const buildRaw = (overrides: Partial<RawPriceObservation> = {}): RawPriceObservation => ({
  source_id: 'sefaz-al',
  gtin: '7894900011517',
  source_canonical_description: 'REFRIGERANTE COCA-COLA GARRAFA 2L',
  raw_description: 'REFRIG COCA-COLA 2L PET',
  fiscal_code: '22021000',
  category_gpc_code: '50000000',
  unit_of_measure: 'UN',
  declared_value: 9.99,
  sale_value: 8.4949,
  sold_at: new Date('2026-05-11T10:00:00Z'),
  establishment: {
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
  },
  ...overrides,
});

describe('NormalizationService.normalize', () => {
  let productRepo: { findOrCreateByGtin: ReturnType<typeof vi.fn> };
  let establishmentRepo: { findOrCreateByCnpj: ReturnType<typeof vi.fn> };
  let svc: NormalizationService;

  beforeEach(() => {
    productRepo = { findOrCreateByGtin: vi.fn().mockResolvedValue(stubProduct) };
    establishmentRepo = { findOrCreateByCnpj: vi.fn().mockResolvedValue(stubEstablishment) };
    svc = new NormalizationService(
      productRepo as unknown as ProductRepository,
      establishmentRepo as unknown as EstablishmentRepository,
    );
  });

  const curatedJob = (gtin: string): JobContext => ({ kind: 'curated_seed', queriedGtin: gtin });
  const discoveryJob = (): JobContext => ({ kind: 'discovery' });

  it('returns { skipped: true, cross_pollution } when curated job sees a different gtin', async () => {
    const raw = buildRaw({ gtin: '0000000000017' });
    const result = await svc.normalize(raw, curatedJob('7894900011517'));
    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.reason).toBe('cross_pollution');
    }
    expect(productRepo.findOrCreateByGtin).not.toHaveBeenCalled();
    expect(establishmentRepo.findOrCreateByCnpj).not.toHaveBeenCalled();
  });

  it('passes through when curated job sees the queried gtin', async () => {
    const raw = buildRaw();
    const result = await svc.normalize(raw, curatedJob('7894900011517'));
    expect(result.skipped).toBe(false);
  });

  it('does NOT apply cross-pollution check for discovery jobs', async () => {
    const raw = buildRaw({ gtin: '9999999999999' });
    const result = await svc.normalize(raw, discoveryJob());
    expect(result.skipped).toBe(false);
  });

  it('uses source_canonical_description when present in product fill', async () => {
    const raw = buildRaw();
    await svc.normalize(raw, curatedJob('7894900011517'));
    const fillFn = productRepo.findOrCreateByGtin.mock.calls[0]?.[1] as () => {
      canonical_description: string;
    };
    expect(fillFn().canonical_description).toBe('REFRIGERANTE COCA-COLA GARRAFA 2L');
  });

  it('falls back to raw_description when source_canonical_description is null', async () => {
    const raw = buildRaw({ source_canonical_description: null });
    await svc.normalize(raw, curatedJob('7894900011517'));
    const fillFn = productRepo.findOrCreateByGtin.mock.calls[0]?.[1] as () => {
      canonical_description: string;
    };
    expect(fillFn().canonical_description).toBe('REFRIG COCA-COLA 2L PET');
  });

  it('rounds sale_value and declared_value to NUMERIC_SCALE decimal places', async () => {
    const raw = buildRaw({ sale_value: 5.889877086039772, declared_value: 9.991234567 });
    const result = await svc.normalize(raw, curatedJob('7894900011517'));
    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      expect(result.data.sale_value).toBe(5.89);
      expect(result.data.declared_value).toBe(9.99);
    }
  });

  it('returns resolved product_id and establishment_id (not the full entities)', async () => {
    const raw = buildRaw();
    const result = await svc.normalize(raw, curatedJob('7894900011517'));
    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      expect(result.data.product_id).toBe(stubProduct.id);
      expect(result.data.establishment_id).toBe(stubEstablishment.id);
      expect(result.data.source_id).toBe('sefaz-al');
      expect(result.data.sold_at).toEqual(new Date('2026-05-11T10:00:00Z'));
    }
  });
});
