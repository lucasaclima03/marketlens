import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/config/env.schema.js';
import { SefazAlAdapter } from './sefaz-al.adapter.js';
import { SefazAlClient } from './sefaz-al.client.js';

@Module({
  providers: [
    {
      provide: SefazAlClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): SefazAlClient =>
        new SefazAlClient({
          baseUrl: config.get('SEFAZ_API_BASE_URL', { infer: true }),
          appToken: config.get('SEFAZ_APP_TOKEN', { infer: true }),
          timeoutMs: config.get('SEFAZ_HTTP_TIMEOUT_MS', { infer: true }),
        }),
    },
    SefazAlAdapter,
  ],
  exports: [SefazAlClient, SefazAlAdapter],
})
export class SefazAlModule {}
