import { http, HttpResponse, type HttpHandler, type JsonBodyType } from 'msw';
// msw 2.14: SetupServerApi replaced by SetupServer (SetupServerApi is still exported but deprecated)
import { setupServer, type SetupServer } from 'msw/node';

export const DEFAULT_SEFAZ_BASE_URL =
  // eslint-disable-next-line sonarjs/no-clear-text-protocols
  'http://api.sefaz.al.gov.br/sfz-economiza-alagoas-api/api/public';

export const createSefazMockServer = (handlers: HttpHandler[] = []): SetupServer =>
  setupServer(...handlers);

export const sefazPesquisaUrl = (baseUrl: string = DEFAULT_SEFAZ_BASE_URL): string =>
  `${baseUrl}/produto/pesquisa`;

// body is typed as unknown at the boundary (fixtures are loaded as unknown); cast to JsonBodyType
// is safe because HttpResponse.json only serialises the value — any JSON-serialisable shape works.
export const okHandler = (body: unknown, baseUrl: string = DEFAULT_SEFAZ_BASE_URL): HttpHandler =>
  http.post(sefazPesquisaUrl(baseUrl), () => HttpResponse.json(body as JsonBodyType));

export const errorHandler = (
  status: number,
  body: unknown,
  baseUrl: string = DEFAULT_SEFAZ_BASE_URL,
): HttpHandler =>
  http.post(sefazPesquisaUrl(baseUrl), () => HttpResponse.json(body as JsonBodyType, { status }));

export interface SefazRequestCapture {
  lastBody?: unknown;
  lastAppToken?: string | null;
}

export const captureHandler = (
  body: unknown,
  capture: SefazRequestCapture,
  baseUrl: string = DEFAULT_SEFAZ_BASE_URL,
): HttpHandler =>
  http.post(sefazPesquisaUrl(baseUrl), async ({ request }) => {
    capture.lastBody = await request.json();
    capture.lastAppToken = request.headers.get('AppToken');
    return HttpResponse.json(body as JsonBodyType);
  });
