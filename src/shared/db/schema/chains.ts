import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const chains = pgTable('chains', {
  id: uuid('id').primaryKey().defaultRandom(),
  cnpj_root: text('cnpj_root').notNull().unique(),
  name: text('name').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ChainRow = typeof chains.$inferSelect;
export type ChainInsert = typeof chains.$inferInsert;
