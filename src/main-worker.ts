import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { IngestionWorkerModule } from './ingestion/ingestion-worker.module.js';

@Module({
  imports: [AppModule, IngestionWorkerModule],
})
class WorkerAppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();
  app.get(PinoLogger).log('Worker process started (curated-seed processor active)');

  // Block until SIGINT/SIGTERM; Nest's shutdown hooks handle teardown,
  // including draining in-flight BullMQ jobs.
  await new Promise<void>(() => {});
}

bootstrap().catch((err) => {
  console.error('Fatal error during Worker bootstrap:', err);
  process.exit(1);
});
