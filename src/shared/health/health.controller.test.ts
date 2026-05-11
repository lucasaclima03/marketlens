import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { HealthController } from './health.controller.js';
import { DATABASE } from '../db/db.module.js';
import { QUEUE_CURATED_SEED } from '../bullmq/queues.js';

type IndicatorStub = ReturnType<HealthIndicatorService['check']>;

function indicatorStub(name: string): IndicatorStub {
  return {
    up: (data?: Record<string, unknown>) => ({ [name]: { status: 'up', ...(data ?? {}) } }),
    down: (data?: Record<string, unknown>) => ({ [name]: { status: 'down', ...(data ?? {}) } }),
  } as unknown as IndicatorStub;
}

const healthCheckServiceStub = {
  check: async (indicators: Array<() => Promise<Record<string, { status: string }>>>) => {
    const results = await Promise.all(indicators.map((fn) => fn()));
    const details = Object.assign({}, ...results) as Record<string, { status: string }>;
    const failed = Object.values(details).some((r) => r.status !== 'up');
    return {
      status: failed ? 'error' : 'ok',
      info: failed ? {} : details,
      error: failed ? details : {},
      details,
    };
  },
};

describe('HealthController', () => {
  let app: INestApplication;
  const dbExecute = vi.fn();
  const redisPing = vi.fn();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheckServiceStub },
        { provide: HealthIndicatorService, useValue: { check: indicatorStub } },
        { provide: DATABASE, useValue: { execute: dbExecute } },
        {
          provide: getQueueToken(QUEUE_CURATED_SEED),
          useValue: { client: Promise.resolve({ ping: redisPing }) },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok when Postgres and Redis are reachable', async () => {
    dbExecute.mockResolvedValueOnce(undefined);
    redisPing.mockResolvedValueOnce('PONG');

    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.details.postgres.status).toBe('up');
    expect(res.body.details.redis.status).toBe('up');
  });

  it('marks Postgres down when SELECT 1 throws', async () => {
    dbExecute.mockRejectedValueOnce(new Error('db unreachable'));
    redisPing.mockResolvedValueOnce('PONG');

    const res = await request(app.getHttpServer()).get('/health');

    expect(res.body.details.postgres.status).toBe('down');
    expect(res.body.details.postgres.message).toBe('db unreachable');
  });

  it('marks Redis down when PING reply is unexpected', async () => {
    dbExecute.mockResolvedValueOnce(undefined);
    redisPing.mockResolvedValueOnce('WRONG');

    const res = await request(app.getHttpServer()).get('/health');

    expect(res.body.details.redis.status).toBe('down');
    expect(res.body.details.redis.message).toBe('unexpected reply');
  });
});
