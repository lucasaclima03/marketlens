import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();
  app.get(PinoLogger).log('Worker process started (M1: no queue processors registered yet)');

  // Block until SIGINT/SIGTERM; Nest's shutdown hooks handle teardown.
  await new Promise<void>(() => {});
}

bootstrap().catch((err) => {
  console.error('Fatal error during Worker bootstrap:', err);
  process.exit(1);
});
