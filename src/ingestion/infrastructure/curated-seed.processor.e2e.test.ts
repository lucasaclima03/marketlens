import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Global, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getQueueToken } from '@nestjs/bullmq';
import { sql } from 'drizzle-orm';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue, QueueEvents } from 'bullmq';
import { setupServer, type SetupServer } from 'msw/node';
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
// SEFAZ AL public API is served over plain HTTP (validated 2026-05-08).
// eslint-disable-next-line sonarjs/no-clear-text-protocols
const SEFAZ_BASE_URL = 'http://api.sefaz.al.gov.br/sfz-economiza-alagoas-api/api/public';
const JOB_TIMEOUT_MS = 30_000;

const loadFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await fs.readFile(join(FIXTURE_DIR, name), 'utf-8'));

describe('CuratedSeed pipeline (e2e: BullMQ Queue → Worker → Postgres, MSW for SEFAZ)', () => {
  let pg: PostgresTestContext;
  let redis: StartedRedisContainer;
  let mockServer: SetupServer;
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

    @Global()
    @Module({
      providers: [{ provide: DATABASE, useValue: pg.db }],
      exports: [DATABASE],
    })
    class TestDbModule {}

    app = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        TestDbModule,
        AppBullMqModule,
        EventEmitterModule.forRoot({ wildcard: false }),
        IngestionModule,
        IngestionWorkerModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue({ get: (key: string) => env[key] })
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
    // BullMQ 5 rejects custom jobIds whose colon-split has != 3 parts (legacy
    // repeatable-job shape); we use underscores instead. Salt with a random
    // suffix to bypass the §9.5 hour-bucket dedup, which is the CLI's
    // idempotency contract — the e2e test needs to enqueue the same
    // (gtin, ibge, hour) tuple multiple times to exercise Case B (extended).
    // eslint-disable-next-line sonarjs/pseudo-random -- test isolation salt, not security
    const jobId = `curated-seed_${gtin}_${ibge}_${hourBucket}_${Math.random()}`;
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
    // eslint-disable-next-line sonarjs/pseudo-random -- test isolation salt, not security
    const jobId = `curated-seed_7894900011517_2704302_${hourBucket}_${Math.random()}`;
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
