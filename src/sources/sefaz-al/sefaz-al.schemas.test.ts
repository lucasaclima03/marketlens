import { describe, expect, it } from 'vitest';
import { sefazAlPriceResponseSchema } from './sefaz-al.schemas.js';

const baseItem = {
  produto: {
    codigo: 'C1',
    descricao: 'COCA COLA 2L',
    gtin: '7894900011517',
    ncm: '22021000',
    gpc: '50000000',
    unidadeMedida: 'UN',
    venda: {
      dataVenda: '2026-05-11T10:00:00Z',
      valorDeclarado: 9.99,
      valorVenda: 8.5,
    },
  },
  estabelecimento: {
    cnpj: '12345678000100',
    razaoSocial: 'SUPERMERCADO TESTE LTDA',
    endereco: {
      nomeLogradouro: 'RUA TESTE',
      numeroImovel: '100',
      bairro: 'CENTRO',
      cep: '57000000',
      codigoIBGE: 2704302,
      municipio: 'MACEIO',
      latitude: -9.66,
      longitude: -35.73,
    },
  },
};

describe('sefazAlPriceResponseSchema', () => {
  it('parses a complete happy-path response', () => {
    const result = sefazAlPriceResponseSchema.safeParse({
      conteudo: [baseItem],
      pagina: 1,
      primeiraPagina: true,
      registrosPagina: 1,
      registrosPorPagina: 100,
      totalPaginas: 1,
      totalRegistros: 1,
      ultimaPagina: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an item with optional descricaoSefaz, nomeFantasia, telefone', () => {
    const withOptionals = {
      ...baseItem,
      produto: { ...baseItem.produto, descricaoSefaz: 'REFRIGERANTE COCA-COLA GARRAFA 2L' },
      estabelecimento: {
        ...baseItem.estabelecimento,
        nomeFantasia: 'SUPER TESTE',
        telefone: '8233334444',
      },
    };
    const result = sefazAlPriceResponseSchema.safeParse({
      conteudo: [withOptionals],
      pagina: 1,
      primeiraPagina: true,
      registrosPagina: 1,
      registrosPorPagina: 100,
      totalPaginas: 1,
      totalRegistros: 1,
      ultimaPagina: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts lat=0, lng=0 (real-world data quality issue, persisted and flagged in M3)', () => {
    const geoZero = {
      ...baseItem,
      estabelecimento: {
        ...baseItem.estabelecimento,
        endereco: { ...baseItem.estabelecimento.endereco, latitude: 0, longitude: 0 },
      },
    };
    const result = sefazAlPriceResponseSchema.safeParse({
      conteudo: [geoZero],
      pagina: 1,
      primeiraPagina: true,
      registrosPagina: 1,
      registrosPorPagina: 100,
      totalPaginas: 1,
      totalRegistros: 1,
      ultimaPagina: true,
    });
    expect(result.success).toBe(true);
  });

  it('parses an empty response (totalRegistros: 0)', () => {
    const result = sefazAlPriceResponseSchema.safeParse({
      conteudo: [],
      pagina: 1,
      primeiraPagina: true,
      registrosPagina: 0,
      registrosPorPagina: 100,
      totalPaginas: 1,
      totalRegistros: 0,
      ultimaPagina: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when produto.gtin is missing', () => {
    const broken = { ...baseItem, produto: { ...baseItem.produto } };
    delete (broken.produto as { gtin?: string }).gtin;
    const result = sefazAlPriceResponseSchema.safeParse({
      conteudo: [broken],
      pagina: 1,
      primeiraPagina: true,
      registrosPagina: 1,
      registrosPorPagina: 100,
      totalPaginas: 1,
      totalRegistros: 1,
      ultimaPagina: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when codigoIBGE arrives as a string instead of a number', () => {
    const broken = {
      ...baseItem,
      estabelecimento: {
        ...baseItem.estabelecimento,
        endereco: { ...baseItem.estabelecimento.endereco, codigoIBGE: '2704302' },
      },
    };
    const result = sefazAlPriceResponseSchema.safeParse({
      conteudo: [broken],
      pagina: 1,
      primeiraPagina: true,
      registrosPagina: 1,
      registrosPorPagina: 100,
      totalPaginas: 1,
      totalRegistros: 1,
      ultimaPagina: true,
    });
    expect(result.success).toBe(false);
  });
});
