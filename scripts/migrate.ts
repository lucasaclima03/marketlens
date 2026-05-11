import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = './drizzle/migrations';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  // Drizzle creates meta/_journal.json on the first `drizzle-kit generate`.
  // The schema is empty in M1, so there is no journal yet — treat as no-op.
  const journalPath = resolve(MIGRATIONS_FOLDER, 'meta/_journal.json');
  if (!existsSync(journalPath)) {
    console.log('No migrations to apply (empty migrations folder).');
    return;
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('Migrations applied successfully.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
