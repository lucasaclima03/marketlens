import { Module } from '@nestjs/common';
import { AppConfigModule } from '../shared/config/config.module.js';
import { AppBullMqModule } from '../shared/bullmq/bullmq.module.js';
import { EnqueueCommand } from './enqueue.command.js';

@Module({
  imports: [AppConfigModule, AppBullMqModule],
  providers: [EnqueueCommand],
})
export class CliModule {}
