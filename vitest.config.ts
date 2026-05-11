import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.test.ts', 'src/**/*.e2e.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
      exclude: [
        '**/*.module.ts',
        '**/main-*.ts',
        '**/*.config.ts',
        'src/shared/db/schema/**',
        'src/shared/db/client.ts',
        'src/shared/bullmq/queues.ts',
        'drizzle/migrations/**',
        '**/types/**',
        '**/index.ts',
        'scripts/**',
        'src/**/*.test.ts',
        'src/**/*.e2e.test.ts',
      ],
    },
  },
});
