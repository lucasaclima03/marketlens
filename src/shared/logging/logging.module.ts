import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
              : undefined,
          autoLogging: true,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers["app-token"]',
              'req.headers["apptoken"]',
            ],
            censor: '[REDACTED]',
          },
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggingModule {}
