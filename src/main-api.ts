import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { ExpressAdapter } from '@nestjs/platform-express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter as BullBoardExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bullmq';
import express from 'express';
import { Queue } from 'bullmq';
import { AppModule } from './app.module.js';
import type { Env } from './shared/config/env.schema.js';
import { QUEUE_CURATED_SEED } from './shared/bullmq/queues.js';

const BULL_BOARD_BASE_PATH = '/admin/queues';

async function bootstrap(): Promise<void> {
  const server = express();
  server.disable('x-powered-by');
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });

  // Bull Board exposes queue internals with no auth; only mount outside production.
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const queue = app.get<Queue>(getQueueToken(QUEUE_CURATED_SEED));
    const bullBoard = new BullBoardExpressAdapter();
    bullBoard.setBasePath(BULL_BOARD_BASE_PATH);
    createBullBoard({ queues: [new BullMQAdapter(queue)], serverAdapter: bullBoard });
    server.use(BULL_BOARD_BASE_PATH, bullBoard.getRouter());
  }

  await app.listen(port);
  app.get(PinoLogger).log(`API process listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during API bootstrap:', err);
  process.exit(1);
});
