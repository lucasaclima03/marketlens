import { Injectable } from '@nestjs/common';
import { roundToScale } from '../domain/numeric-scale.js';
import {
  EstablishmentRepository,
  type EstablishmentFillFields,
} from '../infrastructure/establishment.repository.js';
import { ProductRepository, type ProductFillFields } from '../infrastructure/product.repository.js';
import type { JobContext } from '../domain/job-context.js';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';

export interface NormalizedObservation {
  readonly product_id: string;
  readonly establishment_id: string;
  readonly declared_value: number;
  readonly sale_value: number;
  readonly sold_at: Date;
  readonly source_id: string;
}

export type NormalizationResult =
  | { readonly skipped: true; readonly reason: 'cross_pollution' }
  | { readonly skipped: false; readonly data: NormalizedObservation };

@Injectable()
export class NormalizationService {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly establishmentRepo: EstablishmentRepository,
  ) {}

  async normalize(raw: RawPriceObservation, jobContext: JobContext): Promise<NormalizationResult> {
    if (this.isCrossPollution(raw, jobContext)) {
      return { skipped: true, reason: 'cross_pollution' };
    }

    if (raw.gtin === null) {
      throw new Error('NormalizationService: null-gtin path is reserved for Discovery (M4).');
    }

    const product = await this.productRepo.findOrCreateByGtin(raw.gtin, () =>
      this.productFill(raw),
    );
    const establishment = await this.establishmentRepo.findOrCreateByCnpj(
      raw.establishment.cnpj,
      () => this.establishmentFill(raw),
    );

    return {
      skipped: false,
      data: {
        product_id: product.id,
        establishment_id: establishment.id,
        declared_value: roundToScale(raw.declared_value),
        sale_value: roundToScale(raw.sale_value),
        sold_at: raw.sold_at,
        source_id: raw.source_id,
      },
    };
  }

  private isCrossPollution(raw: RawPriceObservation, jobContext: JobContext): boolean {
    return jobContext.kind === 'curated_seed' && raw.gtin !== jobContext.queriedGtin;
  }

  private productFill(raw: RawPriceObservation): ProductFillFields {
    return {
      canonical_description: raw.source_canonical_description ?? raw.raw_description,
      fiscal_code: raw.fiscal_code,
      category_gpc_code: raw.category_gpc_code,
    };
  }

  private establishmentFill(raw: RawPriceObservation): EstablishmentFillFields {
    return {
      legal_name: raw.establishment.legal_name,
      trade_name: raw.establishment.trade_name,
      street: raw.establishment.street,
      street_number: raw.establishment.street_number,
      neighborhood: raw.establishment.neighborhood,
      postal_code: raw.establishment.postal_code,
      municipality_ibge_code: raw.establishment.municipality_ibge_code,
      municipality_name: raw.establishment.municipality_name,
      latitude: raw.establishment.latitude,
      longitude: raw.establishment.longitude,
    };
  }
}
