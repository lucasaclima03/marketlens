import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { establishments } from './establishments.js';
import { products } from './products.js';

export const priceObservations = pgTable(
  'price_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id),
    establishment_id: uuid('establishment_id')
      .notNull()
      .references(() => establishments.id),
    fetched_at: timestamp('fetched_at', { withTimezone: true }).notNull(),
    last_seen_at: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    sold_at: timestamp('sold_at', { withTimezone: true }).notNull(),
    declared_value: numeric('declared_value', { precision: 12, scale: 4 }).notNull(),
    sale_value: numeric('sale_value', { precision: 12, scale: 4 }).notNull(),
    valid_until: timestamp('valid_until', { withTimezone: true })
      .notNull()
      .default(sql`'infinity'::timestamptz`),
    source_id: text('source_id').notNull(),
    quality_flag: text('quality_flag'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('price_observations_current_row_idx')
      .on(t.product_id, t.establishment_id)
      .where(sql`valid_until = 'infinity'::timestamptz`),
    index('price_observations_product_time_idx').on(t.product_id, t.fetched_at.desc()),
    index('price_observations_establishment_time_idx').on(t.establishment_id, t.fetched_at.desc()),
    check(
      'price_observations_quality_flag_valid',
      sql`quality_flag IS NULL OR quality_flag IN ('price_anomaly', 'ncm_mismatch', 'geo_invalid')`,
    ),
    check('price_observations_last_seen_after_fetched', sql`last_seen_at >= fetched_at`),
  ],
);

export type PriceObservationRow = typeof priceObservations.$inferSelect;
export type PriceObservationInsert = typeof priceObservations.$inferInsert;
