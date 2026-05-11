import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type AppDatabase = PostgresJsDatabase<typeof schema>;

export function createDatabaseClient(databaseUrl: string): AppDatabase {
  const queryClient = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  return drizzle(queryClient, { schema });
}
