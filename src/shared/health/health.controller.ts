import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { sql } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { DATABASE } from '../db/db.module.js';
import type { AppDatabase } from '../db/client.js';
import { QUEUE_CURATED_SEED } from '../bullmq/queues.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    @Inject(DATABASE) private readonly db: AppDatabase,
    @InjectQueue(QUEUE_CURATED_SEED) private readonly curatedSeedQueue: Queue,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.checkPostgres(), () => this.checkRedis()]);
  }

  private async checkPostgres(): Promise<HealthIndicatorResult> {
    const indicator = this.indicators.check('postgres');
    try {
      await this.db.execute(sql`SELECT 1`);
      return indicator.up();
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    }
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    const indicator = this.indicators.check('redis');
    try {
      const client = await this.curatedSeedQueue.client;
      const pong = await client.ping();
      return pong === 'PONG' ? indicator.up() : indicator.down({ message: 'unexpected reply' });
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    }
  }
}
