import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { EnqueueCommand } from './enqueue.command.js';

describe('EnqueueCommand.run', () => {
  it('enqueues a job with the deterministic jobId pattern and matching payload', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job-1' });
    const queue = { add } as unknown as Queue;
    const cmd = new EnqueueCommand(queue);

    await cmd.run([], { gtin: '7894900011517', municipalityIbgeCode: '2704302' });

    expect(add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = add.mock.calls[0] ?? [];
    expect(name).toBe('ingest');
    expect(data).toEqual({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });
    const jobId = (opts as { jobId?: string } | undefined)?.jobId;
    expect(jobId).toMatch(/^curated-seed_7894900011517_2704302_\d{4}-\d{2}-\d{2}T\d{2}$/);
  });
});
