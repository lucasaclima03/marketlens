import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // M1: Worker process bootstraps the same AppModule but exposes no HTTP server.
  // No @Processor classes registered yet — that comes in M2.
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));

  app.enableShutdownHooks();
  app.get(PinoLogger).log('Worker process started (M1: no queue processors registered yet)');

  await new Promise<void>(() => {
    // intentional: process exits on signal; the AppModule's OnApplicationShutdown
    // hooks will drain in-flight work in M2 once processors are added.
  });
}

bootstrap().catch((err) => {
  console.error('Fatal error during Worker bootstrap:', err);
  process.exit(1);
});
