import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorResult } from '@nestjs/terminus';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../db/db.module.js';
import type { AppDatabase } from '../db/client.js';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { QUEUE_CURATED_SEED } from '../bullmq/queues.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @Inject(DATABASE) private readonly db: AppDatabase,
    @InjectQueue(QUEUE_CURATED_SEED) private readonly curatedSeedQueue: Queue,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    return this.health.check([
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.db.execute(sql`SELECT 1`);
          return { postgres: { status: 'up' } };
        } catch (err) {
          return { postgres: { status: 'down', message: (err as Error).message } };
        }
      },
      async (): Promise<HealthIndicatorResult> => {
        try {
          const client = await this.curatedSeedQueue.client;
          const pong = await client.ping();
          return { redis: { status: pong === 'PONG' ? 'up' : 'down' } };
        } catch (err) {
          return { redis: { status: 'down', message: (err as Error).message } };
        }
      },
    ]);
  }
}
