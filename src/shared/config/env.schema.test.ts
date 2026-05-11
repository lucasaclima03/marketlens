import { describe, it, expect } from 'vitest';
import { envSchema } from './env.schema.js';

const validEnv = () => ({
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  SEFAZ_APP_TOKEN: 'tok',
  SEFAZ_API_BASE_URL: 'http://api.example.com',
  SEFAZ_HTTP_TIMEOUT_MS: '35000',
  LOG_LEVEL: 'info',
  NODE_ENV: 'development',
  PORT: '3000',
});

describe('envSchema', () => {
  it('accepts a complete and valid env', () => {
    expect(envSchema.safeParse(validEnv()).success).toBe(true);
  });

  it('rejects when SEFAZ_APP_TOKEN is missing', () => {
    const withoutToken = { ...validEnv(), SEFAZ_APP_TOKEN: undefined };
    expect(envSchema.safeParse(withoutToken).success).toBe(false);
  });

  it('coerces numeric env strings to numbers', () => {
    const parsed = envSchema.parse(validEnv());
    expect(parsed.PORT).toBe(3000);
    expect(parsed.SEFAZ_HTTP_TIMEOUT_MS).toBe(35000);
  });
});
