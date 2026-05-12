import { describe, expect, it } from 'vitest';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';
import { Validator } from './validator.service.js';

const baseRaw: RawPriceObservation = {
  source_id: 'sefaz-al',
  gtin: '7894900011517',
  source_canonical_description: 'REFRIGERANTE COCA-COLA GARRAFA 2L',
  raw_description: 'REFRIG COCA-COLA 2L PET',
  fiscal_code: '22021000',
  category_gpc_code: '50000000',
  unit_of_measure: 'UN',
  declared_value: 9.99,
  sale_value: 8.49,
  sold_at: new Date('2026-05-11T10:00:00Z'),
  establishment: {
    cnpj: '12345678000100',
    legal_name: 'SUPERMERCADO ALFA LTDA',
    trade_name: null,
    street: 'AV TESTE',
    street_number: '100',
    neighborhood: 'CENTRO',
    postal_code: '57000000',
    municipality_ibge_code: '2704302',
    municipality_name: 'MACEIO',
    latitude: -9.66,
    longitude: -35.73,
  },
};

describe('Validator.validate', () => {
  const validator = new Validator();

  it('accepts a fully-valid observation', () => {
    const result = validator.validate(baseRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(baseRaw);
    }
  });

  it('accepts an observation with null gtin (Discovery path)', () => {
    const result = validator.validate({ ...baseRaw, gtin: null });
    expect(result.ok).toBe(true);
  });

  it('rejects when stripped gtin has fewer than 8 digits', () => {
    const result = validator.validate({ ...baseRaw, gtin: '0000000000017' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('gtin_invalid_length');
    }
  });

  it('rejects when stripped gtin has more than 14 digits', () => {
    const result = validator.validate({ ...baseRaw, gtin: '123456789012345' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('gtin_invalid_length');
    }
  });

  it('rejects when GTIN check digit is wrong', () => {
    const result = validator.validate({ ...baseRaw, gtin: '7894900011510' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('gtin_invalid_check_digit');
    }
  });

  it('accepts a valid 8-digit GTIN', () => {
    const result = validator.validate({ ...baseRaw, gtin: '40170725' });
    expect(result.ok).toBe(true);
  });

  it('accepts a valid 14-digit GTIN (DUN-14 case)', () => {
    const result = validator.validate({ ...baseRaw, gtin: '47896006751616' });
    expect(result.ok).toBe(true);
  });

  it('rejects when sale_value is below 0.01', () => {
    const result = validator.validate({ ...baseRaw, sale_value: 0.005 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('sale_value_out_of_range');
    }
  });

  it('rejects when sale_value is above 1_000_000', () => {
    const result = validator.validate({ ...baseRaw, sale_value: 1_000_001 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('sale_value_out_of_range');
    }
  });

  it('rejects on the first failing rule (GTIN length checked before sale value)', () => {
    const result = validator.validate({
      ...baseRaw,
      gtin: '0000000000017',
      sale_value: 0.001,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('gtin_invalid_length');
    }
  });

  it('attaches the raw observation to the HardRejection payload', () => {
    const broken = { ...baseRaw, sale_value: 0 };
    const result = validator.validate(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.raw_payload).toBe(broken);
    }
  });
});
