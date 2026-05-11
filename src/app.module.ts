import { Module } from '@nestjs/common';
import { AppConfigModule } from './shared/config/config.module.js';
import { AppLoggingModule } from './shared/logging/logging.module.js';
import { DbModule } from './shared/db/db.module.js';
import { AppBullMqModule } from './shared/bullmq/bullmq.module.js';
import { HealthModule } from './shared/health/health.module.js';

@Module({
  imports: [AppConfigModule, AppLoggingModule, DbModule, AppBullMqModule, HealthModule],
})
export class AppModule {}
