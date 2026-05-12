import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
        keepClassNames: true,
      },
    }),
  ],
  test: {
    globals: false,
    environment: 'node',
    passWithNoTests: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
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
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.module.ts',
        '**/main-*.ts',
        '**/*.config.{ts,js}',
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
