# M2.3 — Worker + CLI + Done-criterion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close M2 by wiring the BullMQ `CuratedSeedProcessor` into a Worker-only Nest module, adding the `enqueue` CLI command, running an end-to-end test that exercises the real BullMQ Queue + Worker path (Postgres and Redis via Testcontainers, SEFAZ via MSW), and finally executing the done-criterion against the live SEFAZ AL API with a real `SEFAZ_APP_TOKEN`. M2.3 is done when the production-real round-trip lands a row in `price_observations` and CI is green on the M2.3 branch.

**Architecture:** The Worker process is the only place jobs are consumed. To prevent the API process from also consuming jobs, the `@Processor` lives in a Worker-only module (`IngestionWorkerModule`) that the Worker entrypoint composes on top of `AppModule`. The CLI is a standalone nest-commander app importing `AppConfigModule` and `AppBullMqModule` so the queue token is in scope; the command enqueues with a deterministic `jobId` (per spec §9.5) so re-runs in the same hour are no-ops.

**Tech Stack:** `@nestjs/bullmq` v11 (`Processor` + `WorkerHost`), BullMQ 5 (`Queue`, `QueueEvents`), `nest-commander` (CLI), `@testcontainers/redis` (for the e2e test). All installed in M1.

**Reference spec:** `docs/superpowers/specs/2026-05-11-skeleton-and-first-vertical-slice-design.md` — §2.2 (M2 done-criterion), §9 (BullMQ config), §11 (test types). When this plan and the spec disagree, the spec wins.

**Sibling sub-plans:**

- M2.1 — `docs/superpowers/plans/2026-05-11-m2-1-schema-and-domain.md` — schema + domain types (must merge before M2.2).
- M2.2 — `docs/superpowers/plans/2026-05-11-m2-2-acl-and-pipeline.md` — ACL + pipeline + repositories + IngestionService (must merge before M2.3 starts).
- Consolidated reference (do not execute): `docs/superpowers/plans/2026-05-11-m2-consolidated.md`.

**Pre-existing state (after M1 + M2.1 + M2.2):** the full ingestion pipeline runs in-process via `IngestionService.ingest(query)` — synchronous from the caller's point of view, persisting via SCD2, emitting domain events. The Worker process boots `AppModule` but registers no `@Processor`. `BullModule.registerQueue({ name: 'curated-seed' })` is wired in `src/shared/bullmq/bullmq.module.ts`. The `tests/helpers/postgres-container.ts` helper is available from M2.2 Task 8 and the `tests/helpers/sefaz-msw.ts` helper from M2.2 Task 3.

**M2.3 Done criterion (real SEFAZ call, manual):**

```
$ docker-compose -f docker-compose.dev.yml up -d
$ npm run db:migrate
$ npm run start:dev:worker &                                          # Worker active
$ npm run cli -- enqueue --gtin=7894900011517 --municipality-ibge=2704302
  → Job enqueued: id=curated-seed:7894900011517:2704302:<hour>
# ~10s later (SEFAZ latency + persist):
$ psql -c "SELECT count(*) FROM price_observations
           WHERE valid_until = 'infinity'::timestamptz
             AND product_id IN (SELECT id FROM products WHERE gtin = '7894900011517');"
  count > 0   (typically ~50 in Maceió; exact number depends on SEFAZ data)
$ psql -c "SELECT count(*) FROM products WHERE gtin = '7894900011517';"
  count: 1
$ npm test && npm run lint && npm run typecheck && npm run build
$ git push                                                            # CI green
```

---

## File map

The following files are created or modified during M2.3.

**`src/ingestion/infrastructure/`** — the Worker-side processor and its tests:

- Create: `src/ingestion/infrastructure/curated-seed.processor.ts`
- Create: `src/ingestion/infrastructure/curated-seed.processor.test.ts` — unit test for the processor (the `process(job)` delegation), against a mocked `IngestionService`
- Create: `src/ingestion/infrastructure/curated-seed.processor.e2e.test.ts` — true end-to-end test exercising `Queue.add → CuratedSeedProcessor → IngestionService → Postgres`, with Postgres + Redis via Testcontainers and SEFAZ via MSW

**`src/ingestion/`** — Worker-only module:

- Create: `src/ingestion/ingestion-worker.module.ts` — registers `CuratedSeedProcessor`; only imported by Worker

**`src/cli/`** — nest-commander CLI:

- Create: `src/cli/cli.module.ts`
- Create: `src/cli/enqueue.command.ts`
- Create: `src/cli/enqueue.command.test.ts` — unit test for `EnqueueCommand`'s jobId formula and `queue.add` payload
- Create: `src/cli/main.ts`

**Existing files modified:**

- Modify: `src/main-worker.ts` — compose `AppModule + IngestionWorkerModule` so the processor activates only in the Worker process

---

## Task 1: CuratedSeedProcessor + unit test

`CuratedSeedProcessor.process(job)` is intentionally thin — it pulls `gtin` and `municipalityIbgeCode` from the job payload and calls `IngestionService.ingest`. The full pipeline runs inside `IngestionService`; the processor is glue. Job retries are governed by `defaultJobOptions` from M1 (`attempts: 3`, exponential backoff `5s/10s/20s`) — the processor does not need to manage them.

`concurrency: 2` is set on the `@Processor` decorator per spec §9.4. We do not lower or raise this in M2; recalibration is a single-line edit guided by the M3 observability stack (ADR-0004).

The unit test verifies the delegation contract — given a fake `Job`, the processor invokes `IngestionService.ingest` exactly once with the correct query and returns the result verbatim. We are NOT testing the pipeline behavior here (Task 14 of M2.2 covered that); we ARE testing that the BullMQ glue doesn't drop or mangle the payload.

`@nestjs/bullmq` v11 exposes `WorkerHost` as a base class to extend from `@nestjs/bullmq` directly; do not import it from a sub-path.

**Files:**

- Create: `src/ingestion/infrastructure/curated-seed.processor.ts`
- Create: `src/ingestion/infrastructure/curated-seed.processor.test.ts`

- [ ] **Step 1: Write the failing unit test**

Write file `src/ingestion/infrastructure/curated-seed.processor.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { IngestionService } from '../application/ingestion.service.js';
import { CuratedSeedProcessor, type CuratedSeedJobData } from './curated-seed.processor.js';

describe('CuratedSeedProcessor.process', () => {
  it('delegates to IngestionService.ingest with the job payload and returns the result', async () => {
    const ingest = vi.fn().mockResolvedValue({
      fetched: 2,
      persisted: 2,
      extended: 0,
      rejected: 0,
      skipped: 0,
    });
    const ingestion = { ingest } as unknown as IngestionService;

    const processor = new CuratedSeedProcessor(ingestion);
    const fakeJob = {
      id: 'curated-seed:7894900011517:2704302:2026-05-11T10',
      data: { gtin: '7894900011517', municipalityIbgeCode: '2704302' },
    } as Job<CuratedSeedJobData>;

    const result = await processor.process(fakeJob);

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith({
      gtin: '7894900011517',
      municipalityIbgeCode: '2704302',
    });
    expect(result).toEqual({
      fetched: 2,
      persisted: 2,
      extended: 0,
      rejected: 0,
      skipped: 0,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ingestion/infrastructure/curated-seed.processor.test.ts`
Expected: FAIL — cannot find module `./curated-seed.processor.js`.

- [ ] **Step 3: Implement the processor**

Write file `src/ingestion/infrastructure/curated-seed.processor.ts`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_CURATED_SEED } from '../../shared/bullmq/queues.js';
import { IngestionService } from '../application/ingestion.service.js';
import type { IngestionResult } from '../domain/ingestion-result.js';

export interface CuratedSeedJobData {
  readonly gtin: string;
  readonly municipalityIbgeCode: string;
}

@Processor(QUEUE_CURATED_SEED, { concurrency: 2 })
export class CuratedSeedProcessor extends WorkerHost {
  private readonly logger = new Logger(CuratedSeedProcessor.name);

  constructor(private readonly ingestion: IngestionService) {
    super();
  }

  async process(job: Job<CuratedSeedJobData>): Promise<IngestionResult> {
    this.logger.log(
      `curated-seed job ${job.id} starting: gtin=${job.data.gtin}, ibge=${job.data.municipalityIbgeCode}`,
    );
    const result = await this.ingestion.ingest({
      gtin: job.data.gtin,
      municipalityIbgeCode: job.data.municipalityIbgeCode,
    });
    this.logger.log(`curated-seed job ${job.id} done: ${JSON.stringify(result)}`);
    return result;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ingestion/infrastructure/curated-seed.processor.test.ts`
Expected: PASS, 1 test green.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/ingestion/infrastructure/curated-seed.processor.ts src/ingestion/infrastructure/curated-seed.processor.test.ts
git commit -m "feat(ingestion): add CuratedSeedProcessor (BullMQ glue to IngestionService, unit TDD)"
```

---

## Task 2: IngestionWorkerModule + main-worker composition

The Worker entrypoint composes a small NestJS module that wraps `AppModule` and adds `IngestionWorkerModule` — itself only providing `CuratedSeedProcessor`. The API process never imports `IngestionWorkerModule`, so the API never consumes jobs.

**Files:**

- Create: `src/ingestion/ingestion-worker.module.ts`
- Modify: `src/main-worker.ts`

- [ ] **Step 1: Create the Worker-only module**

Write file `src/ingestion/ingestion-worker.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { IngestionModule } from './ingestion.module.js';
import { CuratedSeedProcessor } from './infrastructure/curated-seed.processor.js';

@Module({
  imports: [IngestionModule],
  providers: [CuratedSeedProcessor],
})
export class IngestionWorkerModule {}
```

- [ ] **Step 2: Update `main-worker.ts` to compose AppModule + IngestionWorkerModule**

Overwrite `src/main-worker.ts`:

```typescript
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { IngestionWorkerModule } from './ingestion/ingestion-worker.module.js';

@Module({
  imports: [AppModule, IngestionWorkerModule],
})
class WorkerAppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();
  app.get(PinoLogger).log('Worker process started (curated-seed processor active)');

  // Block until SIGINT/SIGTERM; Nest's shutdown hooks handle teardown,
  // including draining in-flight BullMQ jobs.
  await new Promise<void>(() => {});
}

bootstrap().catch((err) => {
  console.error('Fatal error during Worker bootstrap:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits with code 0.

- [ ] **Step 4: Boot the Worker and verify the processor registers**

Make sure docker-compose services are up:

Run: `docker-compose -f docker-compose.dev.yml up -d`

Run: `npm run start:dev:worker`
Expected: console reaches `Worker process started (curated-seed processor active)` with no DI errors. The `nestjs-bullmq` logger emits an info line on Worker registration (visible in the JSON/pretty stream). Stop with Ctrl-C.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/ingestion/ingestion-worker.module.ts src/main-worker.ts
git commit -m "feat(worker): add IngestionWorkerModule and wire main-worker to register CuratedSeedProcessor"
```

---

## Task 3: End-to-end test via real BullMQ Queue + QueueEvents

This test exercises the real Worker path: a job is added to the queue, the `CuratedSeedProcessor` (registered through `IngestionWorkerModule`) consumes it, runs the pipeline against mocked SEFAZ (MSW), and persists to a real Postgres (Testcontainers) and a real Redis (Testcontainers). The test waits for the job to complete via `QueueEvents` and asserts the resulting database state.

This is the test that closes the "Worker enqueue → process → persist" promise from spec §11. The previous M2.2 task suite covered the orchestrator unit (mocked deps); this task covers the BullMQ wiring + Worker lifecycle.

Key choices in this test:

- One Postgres container + one Redis container per test file, started in `beforeAll`. Migrations applied once.
- `TestingModule` composes `AppConfigModule + AppBullMqModule + EventEmitterModule + IngestionModule + IngestionWorkerModule`, with `ConfigService` overridden to point at the ephemeral container URLs and a dummy SEFAZ token, and `DATABASE` overridden to the test Drizzle client.
- `Queue.add(jobName, data)` enqueues; `QueueEvents.on('completed', ...)` waits for completion.
- Per-test isolation: `pg.truncateAll()` + `await queue.obliterate({ force: true })` (BullMQ's "wipe everything" — completed/failed/active/waiting/delayed all gone).
- MSW handlers are registered per-test via `server.use(...)`.

**Files:**

- Create: `src/ingestion/infrastructure/curated-seed.processor.e2e.test.ts`

- [ ] **Step 1: Write the e2e test**

Write file `src/ingestion/infrastructure/curated-seed.processor.e2e.test.ts`:

```typescript
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getQueueToken } from '@nestjs/bullmq';
import { sql } from 'drizzle-orm';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue, QueueEvents } from 'bullmq';
import { setupServer, type SetupServerApi } from 'msw/node';
import { errorHandler, okHandler } from '../../../tests/helpers/sefaz-msw.js';
import {
  createPostgresTestContext,
  type PostgresTestContext,
} from '../../../tests/helpers/postgres-container.js';
import { AppBullMqModule } from '../../shared/bullmq/bullmq.module.js';
import { AppConfigModule } from '../../shared/config/config.module.js';
import { QUEUE_CURATED_SEED } from '../../shared/bullmq/queues.js';
import { DATABASE } from '../../shared/db/db.module.js';
import { priceObservations } from '../../shared/db/schema/price-observations.js';
import { products } from '../../shared/db/schema/products.js';
import { establishments } from '../../shared/db/schema/establishments.js';
import { IngestionModule } from '../ingestion.module.js';
import { IngestionWorkerModule } from '../ingestion-worker.module.js';

const FIXTURE_DIR = 'tests/fixtures/sefaz-al';
const SEFAZ_BASE_URL = 'http://api.sefaz.al.gov.br/sfz-economiza-alagoas-api/api/public';
const JOB_TIMEOUT_MS = 30_000;

const loadFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await fs.readFile(join(FIXTURE_DIR, name), 'utf-8'));

describe('CuratedSeed pipeline (e2e: BullMQ Queue → Worker → Postgres, MSW for SEFAZ)', () => {
  let pg: PostgresTestContext;
  let redis: StartedRedisContainer;
  let mockServer: SetupServerApi;
  let app: TestingModule;
  let queue: Queue;
  let queueEvents: QueueEvents;

  beforeAll(async () => {
    pg = await createPostgresTestContext();
    redis = await new RedisContainer('redis:7-alpine').start();
    mockServer = setupServer();
    mockServer.listen({ onUnhandledRequest: 'error' });

    const env: Record<string, unknown> = {
      DATABASE_URL: pg.url,
      REDIS_URL: redis.getConnectionUrl(),
      SEFAZ_APP_TOKEN: 'test-token',
      SEFAZ_API_BASE_URL: SEFAZ_BASE_URL,
      SEFAZ_HTTP_TIMEOUT_MS: 35000,
      LOG_LEVEL: 'error',
      NODE_ENV: 'test',
      PORT: 0,
    };

    app = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        AppBullMqModule,
        EventEmitterModule.forRoot({ wildcard: false }),
        IngestionModule,
        IngestionWorkerModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue({ get: (key: string) => env[key] })
      .overrideProvider(DATABASE)
      .useValue(pg.db)
      .compile();
    await app.init();

    queue = app.get<Queue>(getQueueToken(QUEUE_CURATED_SEED));
    queueEvents = new QueueEvents(QUEUE_CURATED_SEED, {
      connection: { url: redis.getConnectionUrl() },
    });
    await queueEvents.waitUntilReady();
  }, 120_000);

  afterAll(async () => {
    await queueEvents?.close();
    await app?.close();
    mockServer?.close();
    await redis?.stop();
    await pg?.cleanup();
  });

  beforeEach(async () => {
    await pg.truncateAll();
    await queue.obliterate({ force: true });
    mockServer.resetHandlers();
  });

  afterEach(() => {
    mockServer.resetHandlers();
  });

  const enqueueAndWait = async (gtin: string, ibge: string): Promise<Record<string, number>> => {
    const hourBucket = new Date().toISOString().slice(0, 13);
    const jobId = `curated-seed:${gtin}:${ibge}:${hourBucket}:${Math.random()}`;
    const job = await queue.add('ingest', { gtin, municipalityIbgeCode: ibge }, { jobId });
    const returnValue = await job.waitUntilFinished(queueEvents, JOB_TIMEOUT_MS);
    return returnValue as Record<string, number>;
  };

  it('Queue.add → Worker consumes → 1 Product + 2 Establishments + 2 current rows', async () => {
    const fixture = await loadFixture('produto-pesquisa-coca2l-maceio.json');
    mockServer.use(okHandler(fixture, SEFAZ_BASE_URL));

    const result = await enqueueAndWait('7894900011517', '2704302');

    expect(result).toEqual({
      fetched: 2,
      persisted: 2,
      extended: 0,
      rejected: 0,
      skipped: 0,
    });

    const productRows = await pg.db.select().from(products);
    const establishmentRows = await pg.db.select().from(establishments);
    const currentRows = await pg.db
      .select()
      .from(priceObservations)
      .where(sql`valid_until = 'infinity'::timestamptz`);

    expect(productRows).toHaveLength(1);
    expect(productRows[0]?.gtin).toBe('7894900011517');
    expect(establishmentRows).toHaveLength(2);
    expect(currentRows).toHaveLength(2);
  });

  it('a second identical run produces 2 extended outcomes and no new rows', async () => {
    const fixture = await loadFixture('produto-pesquisa-coca2l-maceio.json');
    mockServer.use(okHandler(fixture, SEFAZ_BASE_URL));

    await enqueueAndWait('7894900011517', '2704302');
    const second = await enqueueAndWait('7894900011517', '2704302');

    expect(second.extended).toBe(2);
    expect(second.persisted).toBe(0);

    const totalRows = await pg.db.select().from(priceObservations);
    expect(totalRows).toHaveLength(2);
  });

  it('returns all-zero result for an empty fixture', async () => {
    const fixture = await loadFixture('produto-pesquisa-empty.json');
    mockServer.use(okHandler(fixture, SEFAZ_BASE_URL));

    const result = await enqueueAndWait('7894900011517', '2704302');
    expect(result.fetched).toBe(0);
    expect(result.persisted).toBe(0);
  });

  it('skips cross-pollution items when the returned GTIN does not match the queried GTIN', async () => {
    const fixture = await loadFixture('produto-pesquisa-with-descricaoSefaz.json');
    mockServer.use(okHandler(fixture, SEFAZ_BASE_URL));

    const result = await enqueueAndWait('0000000000000', '2704302');
    expect(result.fetched).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.persisted).toBe(0);
  });

  it('records HardRejection in ingestion_failures when SEFAZ returns an invalid GTIN', async () => {
    const fixture = await loadFixture('produto-pesquisa-coca2l-maceio.json');
    const broken = JSON.parse(JSON.stringify(fixture)) as {
      conteudo: { produto: { gtin: string } }[];
    };
    if (broken.conteudo[0]?.produto) {
      broken.conteudo[0].produto.gtin = '0000000000017';
    }
    mockServer.use(okHandler(broken, SEFAZ_BASE_URL));

    const result = await enqueueAndWait('7894900011517', '2704302');
    expect(result.rejected).toBe(1);
    expect(result.persisted).toBe(1);
  });

  it('SEFAZ HTTP 500 propagates as a job failure (no state changes; BullMQ retries 3× per defaults)', async () => {
    const fixture = await loadFixture('produto-pesquisa-token-invalido.json');
    mockServer.use(errorHandler(500, fixture, SEFAZ_BASE_URL));

    const hourBucket = new Date().toISOString().slice(0, 13);
    const jobId = `curated-seed:7894900011517:2704302:${hourBucket}:${Math.random()}`;
    const job = await queue.add(
      'ingest',
      { gtin: '7894900011517', municipalityIbgeCode: '2704302' },
      { jobId, attempts: 1 },
    );
    await expect(job.waitUntilFinished(queueEvents, JOB_TIMEOUT_MS)).rejects.toThrow();

    const rows = await pg.db.select().from(priceObservations);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/ingestion/infrastructure/curated-seed.processor.e2e.test.ts`
Expected: PASS, 6 tests green. (Cold runtime ~90–120s for two containers + Vitest module compile; warm cache ~40–50s.)

If a test hangs in `beforeAll` for more than 120s, suspect Docker availability — re-check `docker info`. If a job hangs in `waitUntilFinished`, the Worker is probably not consuming — verify `IngestionWorkerModule` is in the `TestingModule.imports` list and that `getQueueToken(QUEUE_CURATED_SEED)` resolves a real `Queue` (not `undefined`).

- [ ] **Step 3: Commit**

Run:

```bash
git add src/ingestion/infrastructure/curated-seed.processor.e2e.test.ts
git commit -m "test(e2e): add CuratedSeed Queue→Worker→Postgres end-to-end test (Testcontainers + MSW)"
```

---

## Task 4: CLI `enqueue` command + unit test

The CLI is built on `nest-commander` so future commands (`seed-chains`, `backfill`, `manual-ingest`) can hang off the same NestJS DI graph without rewriting bootstrap. M2 ships exactly one command: `enqueue --gtin <gtin> --municipality-ibge <ibge>`. The command resolves `Queue<curated-seed>` via `@InjectQueue` and calls `queue.add(...)` with a deterministic `jobId` (spec §9.5) so re-runs within the same hour are no-ops.

The unit test mocks the `Queue` and asserts that `run()` produces the right `jobId` pattern (`curated-seed:${gtin}:${ibge}:${YYYY-MM-DDTHH}`) and the right job payload. This locks in the spec §9.5 contract.

**Files:**

- Create: `src/cli/enqueue.command.ts`
- Create: `src/cli/enqueue.command.test.ts`
- Create: `src/cli/cli.module.ts`
- Create: `src/cli/main.ts`

- [ ] **Step 1: Write the failing unit test**

Write file `src/cli/enqueue.command.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { EnqueueCommand } from './enqueue.command.js';

describe('EnqueueCommand.run', () => {
  it('enqueues a job with the deterministic jobId pattern and matching payload', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job-1' });
    const close = vi.fn().mockResolvedValue(undefined);
    const queue = { add, close } as unknown as Queue;
    const cmd = new EnqueueCommand(queue);

    await cmd.run([], { gtin: '7894900011517', municipalityIbge: '2704302' });

    expect(add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = add.mock.calls[0] ?? [];
    expect(name).toBe('ingest');
    expect(data).toEqual({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });
    const jobId = (opts as { jobId?: string } | undefined)?.jobId;
    expect(jobId).toMatch(/^curated-seed:7894900011517:2704302:\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/enqueue.command.test.ts`
Expected: FAIL — cannot find module `./enqueue.command.js`.

- [ ] **Step 3: Implement the command**

Write file `src/cli/enqueue.command.ts`:

```typescript
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Command, CommandRunner, Option } from 'nest-commander';
import { QUEUE_CURATED_SEED } from '../shared/bullmq/queues.js';

interface EnqueueOptions {
  gtin: string;
  municipalityIbge: string;
}

@Command({
  name: 'enqueue',
  description: 'Enqueue a curated-seed ingestion job for one (gtin, municipality) pair',
})
export class EnqueueCommand extends CommandRunner {
  private readonly logger = new Logger(EnqueueCommand.name);

  constructor(@InjectQueue(QUEUE_CURATED_SEED) private readonly queue: Queue) {
    super();
  }

  async run(_passed: string[], options: EnqueueOptions): Promise<void> {
    const hourBucket = new Date().toISOString().slice(0, 13);
    const jobId = `curated-seed:${options.gtin}:${options.municipalityIbge}:${hourBucket}`;
    await this.queue.add(
      'ingest',
      { gtin: options.gtin, municipalityIbgeCode: options.municipalityIbge },
      { jobId },
    );
    this.logger.log(`Job enqueued: id=${jobId}`);
    await this.queue.close();
  }

  @Option({ flags: '--gtin <gtin>', required: true, description: 'GTIN to ingest' })
  parseGtin(val: string): string {
    return val;
  }

  @Option({
    flags: '--municipality-ibge <ibge>',
    required: true,
    description: '7-digit IBGE code (e.g., 2704302 for Maceió)',
  })
  parseIbge(val: string): string {
    return val;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/cli/enqueue.command.test.ts`
Expected: PASS, 1 test green.

- [ ] **Step 5: Create the CLI module**

Write file `src/cli/cli.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AppConfigModule } from '../shared/config/config.module.js';
import { AppBullMqModule } from '../shared/bullmq/bullmq.module.js';
import { EnqueueCommand } from './enqueue.command.js';

@Module({
  imports: [AppConfigModule, AppBullMqModule],
  providers: [EnqueueCommand],
})
export class CliModule {}
```

- [ ] **Step 6: Create the CLI entrypoint**

Write file `src/cli/main.ts`:

```typescript
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
```

- [ ] **Step 7: Smoke-run the CLI**

Make sure docker-compose services are up:

Run: `docker-compose -f docker-compose.dev.yml up -d`

Run: `npm run cli -- --help`
Expected: nest-commander prints usage including the `enqueue` subcommand. If `--help` alone is empty (varies by nest-commander version), try `npm run cli -- enqueue --help`.

Run a real enqueue (no Worker running yet — the job will sit in the queue):

Run: `npm run cli -- enqueue --gtin=7894900011517 --municipality-ibge=2704302`
Expected: prints `Job enqueued: id=curated-seed:7894900011517:2704302:<hour-bucket>` and exits with code 0.

Verify the job is in Redis:

Run:

```bash
docker exec $(docker-compose -f docker-compose.dev.yml ps -q redis) \
  redis-cli KEYS 'bull:curated-seed:*'
```

Expected: at least one key listed (typically the job ID under a hash key like `bull:curated-seed:<jobId>`).

- [ ] **Step 8: Commit**

Run:

```bash
git add src/cli/
git commit -m "feat(cli): add enqueue command (nest-commander, deterministic jobId, unit TDD)"
```

---

## Task 5: M2 done-criterion verification (manual, against real SEFAZ AL)

This is a verification task — no new files. Execute the M2 done-criterion sequence from spec §2.2 against the **real** SEFAZ AL API using a real `SEFAZ_APP_TOKEN`. This is the only place in the entire plan that calls the production API; CI never does.

Prerequisites: a real `SEFAZ_APP_TOKEN` in `.env` (request via email to `api@sefaz.al.gov.br` per the SEFAZ AL Manual v1.0). Without a real token, this task cannot complete and M2 is not done.

- [ ] **Step 1: Confirm real token is configured**

Run: `grep '^SEFAZ_APP_TOKEN=' .env`
Expected: a non-placeholder value (not `<request via email…>`, not `dummy-for-ci`).

If the token is still the placeholder, stop and obtain a real one before continuing.

- [ ] **Step 2: Fresh stack from clean state**

Run:

```bash
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d
```

Expected: both containers `healthy` within ~10s.

Run: `npm run db:migrate`
Expected: `Migrations applied successfully.` (one migration applied; `__drizzle_migrations` has one row).

- [ ] **Step 3: Start the Worker in background**

In one terminal:

Run: `npm run start:dev:worker`
Expected: `Worker process started (curated-seed processor active)`.

Leave this terminal running.

- [ ] **Step 4: Enqueue the canonical GTIN job**

In another terminal:

Run: `npm run cli -- enqueue --gtin=7894900011517 --municipality-ibge=2704302`
Expected: `Job enqueued: id=curated-seed:7894900011517:2704302:<hour-bucket>`.

In the Worker terminal, within ~10 seconds you should see structured log lines:

- `curated-seed job <id> starting: gtin=7894900011517, ibge=2704302`
- `curated-seed job <id> done: {"fetched":N,"persisted":M,"extended":0,"rejected":R,"skipped":S}`

If the Worker logs an error containing `"Autorização do aplicativo não encontrada"`, the token is wrong — Step 1 was passed incorrectly. The BullMQ default retry will fire 3 times before giving up (this is sub-optimal; a future retry-policy ADR fixes it later, deferred per spec §12).

- [ ] **Step 5: Assert database state**

Run:

```bash
docker exec $(docker-compose -f docker-compose.dev.yml ps -q postgres) \
  psql -U marketlens -d marketlens_dev -c \
  "SELECT count(*) FROM products WHERE gtin = '7894900011517';"
```

Expected: exactly `1`.

Run:

```bash
docker exec $(docker-compose -f docker-compose.dev.yml ps -q postgres) \
  psql -U marketlens -d marketlens_dev -c \
  "SELECT count(*) FROM price_observations
   WHERE valid_until = 'infinity'::timestamptz
     AND product_id IN (SELECT id FROM products WHERE gtin = '7894900011517');"
```

Expected: a positive number — typically ~50 in Maceió on a populated day, but the exact count depends on SEFAZ's data at the moment. Any value > 0 demonstrates the pipeline works; values < 5 may indicate sparse data and are not a failure.

Run:

```bash
docker exec $(docker-compose -f docker-compose.dev.yml ps -q postgres) \
  psql -U marketlens -d marketlens_dev -c "SELECT count(*) FROM establishments;"
```

Expected: roughly equal to the current-row count above.

Run:

```bash
docker exec $(docker-compose -f docker-compose.dev.yml ps -q postgres) \
  psql -U marketlens -d marketlens_dev -c "SELECT reason, count(*) FROM ingestion_failures GROUP BY reason;"
```

Expected: zero or a small number of rows — depending on whether SEFAZ returned any placeholder GTINs. A non-zero count for `gtin_invalid_length` or `gtin_invalid_check_digit` is the expected behavior of the Validator (spec §8), not a bug.

Stop the Worker (Ctrl-C).

- [ ] **Step 6: Run the full local quality sequence**

Run:

```bash
npm run lint && npm run format:check && npm run typecheck && npm run build && npm test
```

Expected: all five exit code 0. Test count after M2.3:

- 3 env schema (M1)
- 1 health controller smoke (M1)
- 61 tests from M2.2 (per its wrap-up breakdown)
- 1 CuratedSeedProcessor unit (M2.3 Task 1)
- 6 CuratedSeed e2e (M2.3 Task 3)
- 1 EnqueueCommand unit (M2.3 Task 4)

Total: ~73 tests. Coverage thresholds (statements ≥80%, branches ≥75%, functions ≥80%, lines ≥80%) must pass.

- [ ] **Step 7: Push and verify CI**

Run: `git push`

Open the M2.3 branch on GitHub. The 5 CI jobs (`lint`, `typecheck`, `test`, `build`, `security`) should all turn green.

- [ ] **Step 8: Final commit if any doc cleanup surfaced**

If running the done-criterion revealed a stale comment in CONTEXT.md, README.md, or this plan, fix and commit:

```bash
git add CONTEXT.md README.md docs/superpowers/plans/2026-05-11-m2-3-worker-cli-done.md
git commit -m "docs: refine vertical-slice docs after M2 done-criterion verification"
git push
```

Optional: also clean up the spec §2.2 jobId format example (it shows `2026051114` without separators while §9.5 and this plan use `2026-05-11T14`). The plan and §9.5 are authoritative; §2.2 is the inconsistent one. Fix in the spec, not in the plan.

---

## Wrap-up

M2 (all three sub-plans) is done when:

- All M2.1, M2.2, and M2.3 tasks committed (7 + 15 + 5 = 27 tasks total).
- One real call to SEFAZ AL produces ≥1 row in `products`, ≥1 row in `establishments`, ≥1 current row in `price_observations` for the queried GTIN.
- All Vitest tests pass locally and in CI; coverage thresholds met (≥73 tests total across the three sub-plans).
- `lint`, `format:check`, `typecheck`, `build`, `test` all exit 0.
- CI workflow on the M2.3 branch shows all 5 jobs green.

When M2.3 is merged, M3 begins. M3 candidates (in rough order, each becomes its own ADR + spec + plan triple):

- Future retry-policy ADR: filter for SEFAZ HTTP 500 with `"autoriza"` body.
- `@nestjs/schedule` cron jobs feeding `curated-seed` on the 1h cadence (ADR-0002).
- `OutlierDetector` listener populating `quality_flag` (z-score, NCM mismatch, geo invalid) — future HardRejection vs QualityFlag ADR.
- Observability stack runtime: Prometheus scraping `/metrics` from API and Worker, Grafana dashboards (ADR-0004), event listeners materializing the four counters defined in CONTEXT.md and ADR-0004.
- `/v1/search` HTTP endpoint (future ADRs: search strategy, Postgres FTS).
- Curated `config/chains.yaml` seed (top 20 retailers in Alagoas) + `db:seed-chains` script.

Material that surfaces as side-effects during M2 implementation (lived gotchas, surprising errors, unexpected SEFAZ responses, ESLint Tier S frictions) feeds the article backlog tracked in the memory `project_adr_and_article_plan.md`.
