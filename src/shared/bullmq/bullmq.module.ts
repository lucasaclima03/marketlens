import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { QUEUE_CURATED_SEED } from './queues.js';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }) },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      }),
    }),
    BullModule.registerQueue({
      name: QUEUE_CURATED_SEED,
      settings: {
        lockDuration: 60_000,
        maxStalledCount: 1,
      },
    }),
  ],
  exports: [BullModule],
})
export class AppBullMqModule {}
