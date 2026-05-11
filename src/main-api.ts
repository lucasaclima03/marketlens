import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { ExpressAdapter } from '@nestjs/platform-express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter as BullBoardExpressAdapter } from '@bull-board/express';
import express from 'express';
import { Queue } from 'bullmq';
import { AppModule } from './app.module.js';
import type { Env } from './shared/config/env.schema.js';
import { QUEUE_CURATED_SEED } from './shared/bullmq/queues.js';

async function bootstrap(): Promise<void> {
  const server = express();
  server.disable('x-powered-by');
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });

  const curatedSeedQueue = app.get<Queue>(`BullQueue_${QUEUE_CURATED_SEED}`);
  const bullBoard = new BullBoardExpressAdapter();
  bullBoard.setBasePath('/admin/queues');
  createBullBoard({
    queues: [new BullMQAdapter(curatedSeedQueue)],
    serverAdapter: bullBoard,
  });
  server.use('/admin/queues', bullBoard.getRouter());

  await app.listen(port);
  app.get(PinoLogger).log(`API process listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during API bootstrap:', err);
  process.exit(1);
});
