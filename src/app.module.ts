import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CatalogModule } from './catalog/catalog.module.js';
import { IngestionModule } from './ingestion/ingestion.module.js';
import { AppBullMqModule } from './shared/bullmq/bullmq.module.js';
import { AppConfigModule } from './shared/config/config.module.js';
import { DbModule } from './shared/db/db.module.js';
import { HealthModule } from './shared/health/health.module.js';
import { AppLoggingModule } from './shared/logging/logging.module.js';

@Module({
  imports: [
    AppConfigModule,
    AppLoggingModule,
    DbModule,
    AppBullMqModule,
    EventEmitterModule.forRoot({ wildcard: false }),
    HealthModule,
    CatalogModule,
    IngestionModule,
  ],
})
export class AppModule {}
