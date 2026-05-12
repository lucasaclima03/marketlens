import { sql, type SQL } from 'drizzle-orm';
import { doublePrecision, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { chains } from './chains.js';

export const establishments = pgTable(
  'establishments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cnpj: text('cnpj').notNull().unique(),
    cnpj_root: text('cnpj_root')
      .notNull()
      .generatedAlwaysAs((): SQL => sql`substr(${establishments.cnpj}, 1, 8)`),
    legal_name: text('legal_name').notNull(),
    trade_name: text('trade_name'),
    street: text('street'),
    street_number: text('street_number'),
    neighborhood: text('neighborhood').notNull(),
    postal_code: text('postal_code'),
    municipality_ibge_code: text('municipality_ibge_code').notNull(),
    municipality_name: text('municipality_name').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    chain_id: uuid('chain_id').references(() => chains.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('establishments_cnpj_root_idx').on(t.cnpj_root),
    index('establishments_municipality_idx').on(t.municipality_ibge_code),
  ],
);

export type EstablishmentRow = typeof establishments.$inferSelect;
export type EstablishmentInsert = typeof establishments.$inferInsert;
