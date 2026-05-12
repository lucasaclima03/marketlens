import type { HardRejectionReason } from './hard-rejection.js';
import type { RawPriceObservation } from './raw-price-observation.js';

export const EVENT_PRICE_OBSERVATION_CREATED = 'price_observation.created';
export const EVENT_PRICE_OBSERVATION_EXTENDED = 'price_observation.extended';
export const EVENT_INGESTION_REJECTED = 'ingestion.rejected';

export type PriceObservationCreatedKind = 'first_observation' | 'price_change';

export interface PriceObservationCreatedPayload {
  readonly observation_id: string;
  readonly product_id: string;
  readonly establishment_id: string;
  readonly source_id: string;
  readonly kind: PriceObservationCreatedKind;
}

export interface PriceObservationExtendedPayload {
  readonly observation_id: string;
  readonly product_id: string;
  readonly establishment_id: string;
  readonly source_id: string;
}

export interface IngestionRejectedPayload {
  readonly source_id: string;
  readonly reason: HardRejectionReason;
  readonly raw_payload: RawPriceObservation;
}
