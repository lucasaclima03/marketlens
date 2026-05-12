import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  captureHandler,
  createSefazMockServer,
  errorHandler,
  okHandler,
} from '../../../tests/helpers/sefaz-msw.js';
import { SefazAlClient } from './sefaz-al.client.js';

const FIXTURE_DIR = 'tests/fixtures/sefaz-al';
const loadFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await fs.readFile(join(FIXTURE_DIR, name), 'utf-8'));

describe('SefazAlClient.fetch', () => {
  const server = createSefazMockServer();

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  const buildClient = (): SefazAlClient =>
    new SefazAlClient({
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      baseUrl: 'http://api.sefaz.al.gov.br/sfz-economiza-alagoas-api/api/public',
      appToken: 'test-token',
      timeoutMs: 5000,
    });

  it('issues POST /produto/pesquisa with AppToken header and the expected body shape', async () => {
    const fixture = await loadFixture('produto-pesquisa-coca2l-maceio.json');
    const capture: { lastBody?: unknown; lastAppToken?: string | null } = {};
    server.use(captureHandler(fixture, capture));

    const client = buildClient();
    const response = await client.fetch({
      gtin: '7894900011517',
      municipalityIbgeCode: '2704302',
    });

    expect(response.totalRegistros).toBe(2);
    expect(capture.lastAppToken).toBe('test-token');
    expect(capture.lastBody).toEqual({
      produto: { gtin: '7894900011517' },
      estabelecimento: { municipio: { codigoIBGE: 2704302 } },
      dias: 1,
    });
  });

  it('parses an empty response', async () => {
    const fixture = await loadFixture('produto-pesquisa-empty.json');
    server.use(okHandler(fixture));

    const client = buildClient();
    const response = await client.fetch({
      gtin: '7894900011517',
      municipalityIbgeCode: '2704302',
    });

    expect(response.conteudo).toEqual([]);
    expect(response.totalRegistros).toBe(0);
  });

  it('throws on HTTP 500 with the Spring Boot "autoriza" body', async () => {
    const fixture = await loadFixture('produto-pesquisa-token-invalido.json');
    server.use(errorHandler(500, fixture));

    const client = buildClient();
    await expect(
      client.fetch({ gtin: '7894900011517', municipalityIbgeCode: '2704302' }),
    ).rejects.toThrow();
  });

  it('throws on HTTP 400 (validation error)', async () => {
    const fixture = await loadFixture('produto-pesquisa-gtin-invalido.json');
    server.use(errorHandler(400, fixture));

    const client = buildClient();
    await expect(
      client.fetch({ gtin: '!!INVALID!!', municipalityIbgeCode: '2704302' }),
    ).rejects.toThrow();
  });

  it('throws when the response body fails Zod boundary validation', async () => {
    server.use(okHandler({ totalRegistros: 'not-a-number', conteudo: [] }));

    const client = buildClient();
    await expect(
      client.fetch({ gtin: '7894900011517', municipalityIbgeCode: '2704302' }),
    ).rejects.toThrow();
  });
});
