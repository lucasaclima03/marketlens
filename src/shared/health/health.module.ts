import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller.js';
import { QUEUE_CURATED_SEED } from '../bullmq/queues.js';

@Module({
  imports: [TerminusModule, BullModule.registerQueue({ name: QUEUE_CURATED_SEED })],
  controllers: [HealthController],
})
export class HealthModule {}
