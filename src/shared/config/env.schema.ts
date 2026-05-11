import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres://')),
  REDIS_URL: z.string().url().or(z.string().startsWith('redis://')),
  SEFAZ_APP_TOKEN: z.string().min(1, 'SEFAZ_APP_TOKEN is required'),
  SEFAZ_API_BASE_URL: z.string().url().or(z.string().startsWith('http')),
  SEFAZ_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(35000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type Env = z.infer<typeof envSchema>;
