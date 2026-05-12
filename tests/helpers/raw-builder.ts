import type { RawPriceObservation } from '../../src/ingestion/domain/raw-price-observation.js';

export const buildRaw = (overrides: Partial<RawPriceObservation> = {}): RawPriceObservation => ({
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
