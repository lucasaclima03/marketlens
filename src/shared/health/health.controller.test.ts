import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { HealthCheckResult, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { HealthController } from './health.controller.js';
import { DATABASE } from '../db/db.module.js';
import { QUEUE_CURATED_SEED } from '../bullmq/queues.js';

describe('HealthController (smoke)', () => {
  let app: INestApplication;

  const okResult: HealthCheckResult = {
    status: 'ok',
    info: { postgres: { status: 'up' }, redis: { status: 'up' } },
    error: {},
    details: { postgres: { status: 'up' }, redis: { status: 'up' } },
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check: () => Promise.resolve(okResult) } },
        {
          provide: HealthIndicatorService,
          useValue: { check: () => ({ up: () => ({}), down: () => ({}) }) },
        },
        { provide: DATABASE, useValue: {} },
        { provide: getQueueToken(QUEUE_CURATED_SEED), useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.details.postgres.status).toBe('up');
    expect(res.body.details.redis.status).toBe('up');
  });
});
