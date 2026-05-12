import axios, { type AxiosInstance } from 'axios';
import { sefazAlPriceResponseSchema, type SefazAlPriceResponse } from './sefaz-al.schemas.js';

export interface SefazAlClientOptions {
  readonly baseUrl: string;
  readonly appToken: string;
  readonly timeoutMs: number;
}

export interface SefazAlFetchQuery {
  readonly gtin: string;
  readonly municipalityIbgeCode: string;
}

export class SefazAlClient {
  private readonly http: AxiosInstance;

  constructor(options: SefazAlClientOptions) {
    this.http = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeoutMs,
      headers: { AppToken: options.appToken, 'Content-Type': 'application/json' },
    });
  }

  async fetch(query: SefazAlFetchQuery): Promise<SefazAlPriceResponse> {
    // The IBGE code is a 7-digit identifier and is kept as a string everywhere internally
    // (CONTEXT.md "Municipality"); SEFAZ AL requires `codigoIBGE` as a JSON number, so the
    // string→number coercion happens only at this boundary.
    //
    // `dias` is mandatory per Manual v1.0 §6.1.1 (field 3, "E"). For CuratedSeed at 1h
    // cadence (ADR-0002) the 1-day window covers ample fresh observations given SEFAZ's
    // ~44min delay floor. When Discovery lands (M4) `dias` becomes part of the query type.
    const body = {
      produto: { gtin: query.gtin },
      estabelecimento: { municipio: { codigoIBGE: Number(query.municipalityIbgeCode) } },
      dias: 1,
    };
    const response = await this.http.post('/produto/pesquisa', body);
    return sefazAlPriceResponseSchema.parse(response.data);
  }
}
