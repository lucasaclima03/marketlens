import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { createDatabaseClient, type AppDatabase } from './client.js';

export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): AppDatabase => {
        return createDatabaseClient(config.get('DATABASE_URL', { infer: true }));
      },
    },
  ],
  exports: [DATABASE],
})
export class DbModule {}
