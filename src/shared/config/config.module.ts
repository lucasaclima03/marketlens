import { Module, Global } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { envSchema, type Env } from './env.schema.js';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: (raw: Record<string, unknown>): Env => {
        const result = envSchema.safeParse(raw);
        if (!result.success) {
          const issues = result.error.issues
            .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
            .join('\n');
          throw new Error(`Invalid environment variables:\n${issues}`);
        }
        return result.data;
      },
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}

export { ConfigService };
