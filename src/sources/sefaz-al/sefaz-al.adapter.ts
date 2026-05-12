import { Injectable } from '@nestjs/common';
import type { RawPriceObservation } from '../../ingestion/domain/raw-price-observation.js';
import type { SefazAlPriceItem } from './sefaz-al.schemas.js';

@Injectable()
export class SefazAlAdapter {
  adapt(item: SefazAlPriceItem): RawPriceObservation {
    return {
      source_id: 'sefaz-al',
      gtin: item.produto.gtin,
      source_canonical_description: item.produto.descricaoSefaz ?? null,
      raw_description: item.produto.descricao,
      fiscal_code: item.produto.ncm,
      category_gpc_code: item.produto.gpc,
      unit_of_measure: item.produto.unidadeMedida,
      declared_value: item.produto.venda.valorDeclarado,
      sale_value: item.produto.venda.valorVenda,
      sold_at: new Date(item.produto.venda.dataVenda),
      establishment: {
        cnpj: item.estabelecimento.cnpj,
        legal_name: item.estabelecimento.razaoSocial,
        trade_name: item.estabelecimento.nomeFantasia ?? null,
        street: item.estabelecimento.endereco.nomeLogradouro,
        street_number: item.estabelecimento.endereco.numeroImovel,
        neighborhood: item.estabelecimento.endereco.bairro,
        postal_code: item.estabelecimento.endereco.cep,
        municipality_ibge_code: String(item.estabelecimento.endereco.codigoIBGE),
        municipality_name: item.estabelecimento.endereco.municipio,
        latitude: item.estabelecimento.endereco.latitude,
        longitude: item.estabelecimento.endereco.longitude,
      },
    };
  }
}
