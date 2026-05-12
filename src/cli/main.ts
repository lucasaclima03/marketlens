import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli.module.js';

async function bootstrap(): Promise<void> {
  await CommandFactory.run(CliModule, ['warn', 'error']);
}

bootstrap().catch((err) => {
  console.error('Fatal error in CLI:', err);
  process.exit(1);
});
