import { describe, expect, it } from 'vitest';
import { SefazAlAdapter } from './sefaz-al.adapter.js';
import type { SefazAlPriceItem } from './sefaz-al.schemas.js';

const baseItem: SefazAlPriceItem = {
  produto: {
    codigo: 'C1',
    descricao: 'REFRIG COCA-COLA 2L PET',
    descricaoSefaz: 'REFRIGERANTE COCA-COLA GARRAFA 2L',
    gtin: '7894900011517',
    ncm: '22021000',
    gpc: '50000000',
    unidadeMedida: 'UN',
    venda: {
      dataVenda: '2026-05-11T10:00:00Z',
      valorDeclarado: 9.99,
      valorVenda: 8.49,
    },
  },
  estabelecimento: {
    cnpj: '12345678000100',
    razaoSocial: 'SUPERMERCADO ALFA LTDA',
    nomeFantasia: 'ALFA SUPER',
    telefone: '8233334444',
    endereco: {
      nomeLogradouro: 'AV FERNANDES LIMA',
      numeroImovel: '1500',
      bairro: 'FAROL',
      cep: '57051000',
      codigoIBGE: 2704302,
      municipio: 'MACEIO',
      latitude: -9.6498,
      longitude: -35.7378,
    },
  },
};

describe('SefazAlAdapter.adapt', () => {
  const adapter = new SefazAlAdapter();

  it('maps a complete item into RawPriceObservation', () => {
    const raw = adapter.adapt(baseItem);

    expect(raw.source_id).toBe('sefaz-al');
    expect(raw.gtin).toBe('7894900011517');
    expect(raw.source_canonical_description).toBe('REFRIGERANTE COCA-COLA GARRAFA 2L');
    expect(raw.raw_description).toBe('REFRIG COCA-COLA 2L PET');
    expect(raw.fiscal_code).toBe('22021000');
    expect(raw.category_gpc_code).toBe('50000000');
    expect(raw.unit_of_measure).toBe('UN');
    expect(raw.declared_value).toBe(9.99);
    expect(raw.sale_value).toBe(8.49);
    expect(raw.sold_at.toISOString()).toBe('2026-05-11T10:00:00.000Z');
  });

  it('maps the establishment block including the optional trade_name and converts codigoIBGE to a string', () => {
    const raw = adapter.adapt(baseItem);

    expect(raw.establishment.cnpj).toBe('12345678000100');
    expect(raw.establishment.legal_name).toBe('SUPERMERCADO ALFA LTDA');
    expect(raw.establishment.trade_name).toBe('ALFA SUPER');
    expect(raw.establishment.street).toBe('AV FERNANDES LIMA');
    expect(raw.establishment.street_number).toBe('1500');
    expect(raw.establishment.neighborhood).toBe('FAROL');
    expect(raw.establishment.postal_code).toBe('57051000');
    expect(raw.establishment.municipality_ibge_code).toBe('2704302');
    expect(raw.establishment.municipality_name).toBe('MACEIO');
    expect(raw.establishment.latitude).toBe(-9.6498);
    expect(raw.establishment.longitude).toBe(-35.7378);
  });

  it('returns null for source_canonical_description when descricaoSefaz is absent', () => {
    const withoutSefazDesc: SefazAlPriceItem = {
      ...baseItem,
      produto: { ...baseItem.produto, descricaoSefaz: undefined },
    };
    const raw = adapter.adapt(withoutSefazDesc);
    expect(raw.source_canonical_description).toBeNull();
  });

  it('returns null for trade_name when nomeFantasia is absent', () => {
    const withoutTradeName: SefazAlPriceItem = {
      ...baseItem,
      estabelecimento: { ...baseItem.estabelecimento, nomeFantasia: undefined },
    };
    const raw = adapter.adapt(withoutTradeName);
    expect(raw.establishment.trade_name).toBeNull();
  });

  it('carries through lat=0 and lng=0 (data-quality case persisted in M2; flagged in M3)', () => {
    const geoZero: SefazAlPriceItem = {
      ...baseItem,
      estabelecimento: {
        ...baseItem.estabelecimento,
        endereco: { ...baseItem.estabelecimento.endereco, latitude: 0, longitude: 0 },
      },
    };
    const raw = adapter.adapt(geoZero);
    expect(raw.establishment.latitude).toBe(0);
    expect(raw.establishment.longitude).toBe(0);
  });
});
