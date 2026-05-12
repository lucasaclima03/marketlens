import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../shared/db/client.js';
import { DATABASE } from '../../shared/db/db.module.js';
import { NUMERIC_SCALE } from '../domain/numeric-scale.js';
import {
  priceObservations,
  type PriceObservationRow,
} from '../../shared/db/schema/price-observations.js';

interface InsertPayload {
  readonly declaredStr: string;
  readonly saleStr: string;
  readonly now: Date;
}

export interface PersistInput {
  readonly product_id: string;
  readonly establishment_id: string;
  readonly declared_value: number;
  readonly sale_value: number;
  readonly sold_at: Date;
  readonly source_id: string;
}

export type PersistOutcome = 'first_observation' | 'extended' | 'price_change';

export interface PersistResult {
  readonly observation: PriceObservationRow;
  readonly outcome: PersistOutcome;
}

@Injectable()
export class PriceObservationRepository {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}

  async persist(input: PersistInput): Promise<PersistResult> {
    const declaredStr = input.declared_value.toFixed(NUMERIC_SCALE);
    const saleStr = input.sale_value.toFixed(NUMERIC_SCALE);

    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(priceObservations)
        .where(
          and(
            eq(priceObservations.product_id, input.product_id),
            eq(priceObservations.establishment_id, input.establishment_id),
            sql`valid_until = 'infinity'::timestamptz`,
          ),
        )
        .for('update')
        .limit(1);

      const now = new Date();

      if (!current) {
        return {
          observation: await insertNew(tx, input, { declaredStr, saleStr, now }),
          outcome: 'first_observation',
        };
      }

      const valuesMatch =
        current.declared_value === declaredStr &&
        current.sale_value === saleStr &&
        current.sold_at.getTime() === input.sold_at.getTime();

      if (valuesMatch) {
        const [updated] = await tx
          .update(priceObservations)
          .set({ last_seen_at: now })
          .where(eq(priceObservations.id, current.id))
          .returning();
        if (!updated) throw new Error('Update returned no row');
        return { observation: updated, outcome: 'extended' };
      }

      await tx
        .update(priceObservations)
        .set({ valid_until: now })
        .where(eq(priceObservations.id, current.id));
      return {
        observation: await insertNew(tx, input, { declaredStr, saleStr, now }),
        outcome: 'price_change',
      };
    });
  }
}

async function insertNew(
  tx: Parameters<Parameters<AppDatabase['transaction']>[0]>[0],
  input: PersistInput,
  payload: InsertPayload,
): Promise<PriceObservationRow> {
  const [inserted] = await tx
    .insert(priceObservations)
    .values({
      product_id: input.product_id,
      establishment_id: input.establishment_id,
      fetched_at: payload.now,
      last_seen_at: payload.now,
      sold_at: input.sold_at,
      declared_value: payload.declaredStr,
      sale_value: payload.saleStr,
      source_id: input.source_id,
    })
    .returning();
  if (!inserted) throw new Error('Insert returned no row');
  return inserted;
}
