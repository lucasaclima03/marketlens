import type { RawPriceObservation } from './raw-price-observation.js';

export const HARD_REJECTION_REASONS = [
  'gtin_invalid_length',
  'gtin_invalid_check_digit',
  'sale_value_out_of_range',
] as const;

export type HardRejectionReason = (typeof HARD_REJECTION_REASONS)[number];

export interface HardRejection {
  readonly reason: HardRejectionReason;
  readonly raw_payload: RawPriceObservation;
}

export const hardRejection = (
  reason: HardRejectionReason,
  raw_payload: RawPriceObservation,
): HardRejection => ({ reason, raw_payload });
