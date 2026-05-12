import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const ingestionFailures = pgTable(
  'ingestion_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source_id: text('source_id').notNull(),
    reason: text('reason').notNull(),
    raw_payload: jsonb('raw_payload').notNull(),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ingestion_failures_reason_idx').on(t.reason),
    index('ingestion_failures_occurred_at_idx').on(t.occurred_at.desc()),
  ],
);

export type IngestionFailureRow = typeof ingestionFailures.$inferSelect;
export type IngestionFailureInsert = typeof ingestionFailures.$inferInsert;
