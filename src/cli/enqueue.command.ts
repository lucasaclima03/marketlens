import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Command, CommandRunner, Option } from 'nest-commander';
import { QUEUE_CURATED_SEED } from '../shared/bullmq/queues.js';

interface EnqueueOptions {
  gtin: string;
  municipalityIbgeCode: string;
}

@Command({
  name: 'enqueue',
  description: 'Enqueue a curated-seed ingestion job for one (gtin, municipality) pair',
})
export class EnqueueCommand extends CommandRunner {
  constructor(@InjectQueue(QUEUE_CURATED_SEED) private readonly queue: Queue) {
    super();
  }

  async run(_passed: string[], options: EnqueueOptions): Promise<void> {
    const hourBucket = new Date().toISOString().slice(0, 13);
    const jobId = `curated-seed_${options.gtin}_${options.municipalityIbgeCode}_${hourBucket}`;
    await this.queue.add(
      'ingest',
      { gtin: options.gtin, municipalityIbgeCode: options.municipalityIbgeCode },
      { jobId },
    );
    // process.stdout.write bypasses the NestJS log-level filter so the
    // user-facing confirmation always reaches the terminal.
    process.stdout.write(`Job enqueued: id=${jobId}\n`);
  }

  @Option({ flags: '--gtin <gtin>', required: true, description: 'GTIN to ingest' })
  parseGtin(val: string): string {
    return val;
  }

  @Option({
    flags: '--municipality-ibge-code <code>',
    required: true,
    description: '7-digit IBGE code (e.g., 2704302 for Maceió)',
  })
  parseIbgeCode(val: string): string {
    return val;
  }
}
