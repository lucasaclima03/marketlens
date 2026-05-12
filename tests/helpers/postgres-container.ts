import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import * as schema from '../../src/shared/db/schema/index.js';

export interface PostgresTestContext {
  readonly db: PostgresJsDatabase<typeof schema>;
  readonly url: string;
  readonly truncateAll: () => Promise<void>;
  readonly cleanup: () => Promise<void>;
}

const TRUNCATE_SQL = sql`
  TRUNCATE TABLE
    price_observations,
    ingestion_failures,
    establishments,
    products,
    chains
  RESTART IDENTITY CASCADE
`;

export async function createPostgresTestContext(): Promise<PostgresTestContext> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const url = container.getConnectionUri();

  const migrationClient: Sql = postgres(url, { max: 1 });
  await migrate(drizzle(migrationClient), { migrationsFolder: './drizzle/migrations' });
  await migrationClient.end();

  const queryClient = postgres(url, { max: 5 });
  const db = drizzle(queryClient, { schema });

  return {
    db,
    url,
    truncateAll: async () => {
      await db.execute(TRUNCATE_SQL);
    },
    cleanup: async () => {
      await queryClient.end({ timeout: 5 });
      await stopQuietly(container);
    },
  };
}

async function stopQuietly(container: StartedPostgreSqlContainer): Promise<void> {
  try {
    await container.stop();
  } catch {
    // best-effort cleanup; container may already be stopped during teardown
  }
}
