import { Injectable } from '@nestjs/common';
import { hardRejection, type HardRejection } from '../domain/hard-rejection.js';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';
import { err, ok, type Result } from '../domain/result.js';

const MIN_SALE_VALUE = 0.01;
const MAX_SALE_VALUE = 1_000_000;
const GTIN_MIN_LENGTH = 8;
const GTIN_MAX_LENGTH = 14;

@Injectable()
export class Validator {
  validate(raw: RawPriceObservation): Result<RawPriceObservation, HardRejection> {
    if (raw.gtin !== null) {
      const stripped = raw.gtin.replace(/^0+/, '');
      if (stripped.length < GTIN_MIN_LENGTH || stripped.length > GTIN_MAX_LENGTH) {
        return err(hardRejection('gtin_invalid_length', raw));
      }
      if (!isValidGs1CheckDigit(raw.gtin)) {
        return err(hardRejection('gtin_invalid_check_digit', raw));
      }
    }

    if (raw.sale_value < MIN_SALE_VALUE || raw.sale_value > MAX_SALE_VALUE) {
      return err(hardRejection('sale_value_out_of_range', raw));
    }

    return ok(raw);
  }
}

function isValidGs1CheckDigit(gtin: string): boolean {
  if (!/^\d+$/.test(gtin)) return false;
  const digits = gtin.split('').map(Number);
  const check = digits[digits.length - 1];
  if (check === undefined) return false;
  const body = digits.slice(0, -1).reverse();
  const sum = body.reduce<number>((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  const expected = (10 - (sum % 10)) % 10;
  return expected === check;
}
