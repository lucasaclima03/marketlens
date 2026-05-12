import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gtin: text('gtin'),
    fallback_hash: text('fallback_hash'),
    canonical_description: text('canonical_description').notNull(),
    fiscal_code: text('fiscal_code').notNull(),
    category_gpc_code: text('category_gpc_code').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    gtinUnique: uniqueIndex('products_gtin_unique_idx')
      .on(t.gtin)
      .where(sql`gtin IS NOT NULL`),
    fallbackHashUnique: uniqueIndex('products_fallback_hash_unique_idx')
      .on(t.fallback_hash)
      .where(sql`fallback_hash IS NOT NULL`),
    exactlyOneId: check(
      'products_exactly_one_id',
      sql`(gtin IS NOT NULL)::int + (fallback_hash IS NOT NULL)::int = 1`,
    ),
  }),
);

export type ProductRow = typeof products.$inferSelect;
export type ProductInsert = typeof products.$inferInsert;
