export interface RawPriceObservation {
  readonly source_id: string;
  readonly gtin: string | null;
  readonly source_canonical_description: string | null;
  readonly raw_description: string;
  readonly fiscal_code: string;
  readonly category_gpc_code: string;
  readonly unit_of_measure: string;
  readonly declared_value: number;
  readonly sale_value: number;
  readonly sold_at: Date;
  readonly establishment: {
    readonly cnpj: string;
    readonly legal_name: string;
    readonly trade_name: string | null;
    readonly street: string | null;
    readonly street_number: string | null;
    readonly neighborhood: string;
    readonly postal_code: string | null;
    readonly municipality_ibge_code: string;
    readonly municipality_name: string;
    readonly latitude: number | null;
    readonly longitude: number | null;
  };
}
