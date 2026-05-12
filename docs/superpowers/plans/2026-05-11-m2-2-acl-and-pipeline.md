# M2.2 — ACL + Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On top of M2.1's schema and domain types, build the SEFAZ AL Anti-Corruption Layer (Zod boundary schemas + client + adapter), the Validator with 3 HardRejection rules, the NormalizationService (cross-pollution defense + find-or-create + price rounding), four repositories with integration tests against ephemeral Postgres, and the IngestionService orchestrator that runs the full pipeline. M2.2 is done when the entire pipeline can be invoked from an integration test against a real Postgres container with HTTP mocked via MSW, producing the expected ingestion result. No Worker, no CLI, no live SEFAZ call — those land in M2.3.

**Architecture:** Per-feature folders (`src/ingestion/`, `src/catalog/`, `src/sources/sefaz-al/`) layered as `domain → application → infrastructure`. SEFAZ is an Anti-Corruption Layer (ADR-0001): Zod-validated boundary plus an adapter to canonical `RawPriceObservation`. The IngestionService orchestrates per item; the 8-verb pipeline (`fetch → adapt → validate → normalize → persist`) emits domain events via `@nestjs/event-emitter`. SCD Type 2 persistence uses `(declared_value, sale_value, sold_at)` as the equality predicate, with a partial UNIQUE index protecting against concurrent inserts of duplicate current rows. To respect the ESLint Tier S `max-params: 4` rule, the IngestionService aggregates its application-side collaborators (Validator, NormalizationService, PriceObservationRepository, IngestionFailureRepository) through an `IngestionPipeline` Nest-managed bundle; only `SefazAlClient`, `SefazAlAdapter`, `IngestionPipeline`, and `EventEmitter2` are injected directly.

**Tech Stack:** Drizzle ORM (postgres-js), Zod 3, axios via `@nestjs/axios`, `@nestjs/event-emitter`, Vitest 2 + MSW 2 + `@testcontainers/postgresql` (all installed in M1). `nestjs-pino` for structured logging in services that need it.

**Reference spec:** `docs/superpowers/specs/2026-05-11-skeleton-and-first-vertical-slice-design.md` — §3.3 (pipeline data flow), §3.4 (domain event payloads), §4 (schema), §8 (HardRejection rules), §11 (test types). When this plan and the spec disagree, the spec wins.

**Sibling sub-plans:**

- M2.1 — `docs/superpowers/plans/2026-05-11-m2-1-schema-and-domain.md` — schema migrations + domain types (must merge before this plan starts).
- M2.3 — `docs/superpowers/plans/2026-05-11-m2-3-worker-cli-done.md` — Worker processor + e2e via BullMQ + CLI + done-criterion against real SEFAZ.
- Consolidated reference (do not execute): `docs/superpowers/plans/2026-05-11-m2-consolidated.md`.

**Pre-existing state (after M1 + M2.1):** 5 tables exist in the migrated dev database; `RawPriceObservation`, `Result`, `JobContext`, `HardRejection`, `IngestionResult`, and the three domain event payload types are defined in `src/ingestion/domain/`. `BullModule.registerQueue({ name: 'curated-seed' })` is wired in `src/shared/bullmq/bullmq.module.ts`; the Worker process boots but registers no `@Processor` yet (that lands in M2.3). `AppConfigModule`, `DbModule`, and `AppBullMqModule` are `@Global()` in M1's composition, so `ConfigService`, `DATABASE`, and `@InjectQueue` are reachable without re-importing here.

**Spec §3.3 "per-item transaction" — explicit interpretation:** Spec §3.3 says "Each item in `response.conteudo` is processed in its own Postgres transaction (per-item boundary)." This plan reads that as the **iteration boundary** — one item failing does not abort the rest of the response — implemented by running each item through `processOne` independently and catching/recording rejections inline. The SQL transactional boundary lives inside the repositories: `ProductRepository.findOrCreateByGtin`, `EstablishmentRepository.findOrCreateByCnpj`, and `PriceObservationRepository.persist` each wrap a single Postgres transaction with `SELECT ... FOR UPDATE` for race protection. Find-or-create operations are idempotent under repeat invocation; the SCD2 persist holds the only multi-row write (close old + insert new). Wrapping the three repository calls in one outer transaction was considered and rejected because (a) it requires threading the `tx` through the three repository signatures, increasing surface; (b) the idempotent design makes partial-state recovery automatic on re-run; (c) the spec's "per-item" wording is satisfied by ensuring no inter-item state leak, which the current design provides.

**M2.2 Done criterion (local, no SEFAZ calls):**

```
$ docker info                                  # Docker daemon up (Testcontainers prerequisite)
$ npm run lint && npm run format:check && npm run typecheck && npm run build && npm test
                                               # all exit 0; full Vitest suite covers
                                               # SEFAZ schemas+client+adapter, Validator,
                                               # NormalizationService, 4 repositories
                                               # (integration via Testcontainers), and
                                               # IngestionService (orchestrator unit)
$ git push                                     # CI green on all 5 jobs
```

---

## File map

The following files are created or modified during M2.2.

**`src/sources/sefaz-al/`** — Anti-Corruption Layer for SEFAZ Alagoas:

- Create: `src/sources/sefaz-al/sefaz-al.schemas.ts` — Zod boundary schemas
- Create: `src/sources/sefaz-al/sefaz-al.schemas.test.ts`
- Create: `src/sources/sefaz-al/sefaz-al.client.ts`
- Create: `src/sources/sefaz-al/sefaz-al.client.test.ts`
- Create: `src/sources/sefaz-al/sefaz-al.adapter.ts`
- Create: `src/sources/sefaz-al/sefaz-al.adapter.test.ts`
- Create: `src/sources/sefaz-al/sefaz-al.module.ts`

**`src/ingestion/application/`** — pipeline services + injectable bundle:

- Create: `src/ingestion/application/validator.service.ts`
- Create: `src/ingestion/application/validator.service.test.ts`
- Create: `src/ingestion/application/normalization.service.ts`
- Create: `src/ingestion/application/normalization.service.test.ts`
- Create: `src/ingestion/application/ingestion-pipeline.ts` — injectable bundle (Validator + Normalization + PriceObservationRepository + IngestionFailureRepository) consumed by `IngestionService` to respect `max-params: 4`
- Create: `src/ingestion/application/ingestion.service.ts`
- Create: `src/ingestion/application/ingestion.service.test.ts`

**`src/ingestion/infrastructure/`** — repositories:

- Create: `src/ingestion/infrastructure/product.repository.ts`
- Create: `src/ingestion/infrastructure/product.repository.test.ts`
- Create: `src/ingestion/infrastructure/establishment.repository.ts`
- Create: `src/ingestion/infrastructure/establishment.repository.test.ts`
- Create: `src/ingestion/infrastructure/ingestion-failure.repository.ts`
- Create: `src/ingestion/infrastructure/ingestion-failure.repository.test.ts`
- Create: `src/ingestion/infrastructure/price-observation.repository.ts`
- Create: `src/ingestion/infrastructure/price-observation.repository.test.ts`

**`src/ingestion/domain/`** — small helper added on top of the M2.1 types:

- Create: `src/ingestion/domain/numeric-scale.ts` — single `roundToScale(value, scale)` helper consumed by NormalizationService and PriceObservationRepository

**`src/catalog/`** — domain entity types:

- Create: `src/catalog/domain/product.ts`
- Create: `src/catalog/domain/establishment.ts`
- Create: `src/catalog/domain/chain.ts`
- Create: `src/catalog/catalog.module.ts`

**`src/ingestion/`** — main feature module:

- Create: `src/ingestion/ingestion.module.ts` — application services + repositories + `IngestionPipeline`; exports `IngestionService` only (repositories stay internal until a real cross-module consumer appears)

**`tests/helpers/`** — shared test infrastructure:

- Create: `tests/helpers/sefaz-msw.ts` — MSW server lifecycle (Task 3)
- Create: `tests/helpers/postgres-container.ts` — Testcontainers Postgres lifecycle (Task 8)

**`tests/fixtures/sefaz-al/`** — 8 synthetic SEFAZ AL response fixtures (Task 2):

- Create: `tests/fixtures/sefaz-al/produto-pesquisa-coca2l-maceio.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-empty.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-token-invalido.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-gtin-invalido.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-codigoIBGE-string.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-with-descricaoSefaz.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-without-descricaoSefaz.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-geo-zero.json`

**Existing files modified:**

- Modify: `vitest.config.ts` — bump `testTimeout` to `60_000` ms (Task 8); coverage excludes already cover schemas and configs
- Modify: `src/app.module.ts` — add `EventEmitterModule.forRoot({ wildcard: false })`, `CatalogModule`, `IngestionModule` (Task 15)

No files in `src/main-*.ts`, `src/cli/`, or `src/ingestion/infrastructure/curated-seed.processor.ts` are touched in M2.2 — those land in M2.3.

---

## Task 1: SEFAZ AL Zod boundary schemas — TDD

The Zod schemas in `sefaz-al.schemas.ts` are the formal contract for what the SEFAZ AL API may return. They reject malformed responses at the network boundary, before any code further down the pipeline sees the data. The schemas mirror the validated shape catalogued in `memory/project_sefaz_al_api_spec.md` (12+ real curl calls on 2026-05-08): `descricaoSefaz` is optional, `latitude`/`longitude` may be `0`, `codigoIBGE` is a `number` (not a string), `unidadeMedida` is always present, dates arrive as ISO 8601 with `Z`.

We **do not** use `.strict()` — SEFAZ may add new optional fields without warning; failing on unknown fields would make us brittle. Required fields, however, must be present (per Risk in spec §14: "fixtures drift" mitigation a).

**Files:**

- Create: `src/sources/sefaz-al/sefaz-al.schemas.ts`
- Create: `src/sources/sefaz-al/sefaz-al.schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Write file `src/sources/sefaz-al/sefaz-al.schemas.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { sefazAlPriceResponseSchema } from './sefaz-al.schemas.js';

const baseItem = {
  produto: {
    codigo: 'C1',
    descricao: 'COCA COLA 2L',
    gtin: '7894900011517',
    ncm: '22021000',
    gpc: '50000000',
    unidadeMedida: 'UN',
    venda: {
      dataVenda: '2026-05-11T10:00:00Z',
      valorDeclarado: 9.99,
      valorVenda: 8.5,
    },
  },
  estabelecimento: {
    cnpj: '12345678000100',
    razaoSocial: 'SUPERMERCADO TESTE LTDA',
    endereco: {
      nomeLogradouro: 'RUA TESTE',
      numeroImovel: '100',
      bairro: 'CENTRO',
      cep: '57000000',
      codigoIBGE: 2704302,
      municipio: 'MACEIO',
      latitude: -9.66,
      longitude: -35.73,
    },
  },
};

describe('sefazAlPriceResponseSchema', () => {
  it('parses a complete happy-path response', () => {
    const result = sefazAlPriceResponseSchema.safeParse({
      conteudo: [baseItem],
      pagina: 1,
      primeiraPagina: true,
      registrosPagina: 1,
      registrosPorPagina: 100,
      totalPaginas: 1,
      totalRegistros: 1,
      ultimaPagina: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an item with optional descricaoSefaz, nomeFantasia, telefone', () => {
    const withOptionals = {
      ...baseItem,
      produto: { ...baseItem.produto, descricaoSefaz: 'REFRIGERANTE COCA-COLA GARRAFA 2L' },
      estabelecimento: {
        ...baseItem.estabelecimento,
        nomeFantasia: 'SUPER TESTE',
        telefone: '8233334444',
      },
    };
    const result = sefazAlPriceResponseSchema.safeParse({
      conteudo: [withOptionals],
      pagina: 1,
      primeiraPagina: true,
      registrosPagina: 1,
      registrosPorPagina: 100,
      totalPaginas: 1,
      totalRegistros: 1,
      ultimaPagina: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts lat=0, lng=0 (real-world data quality issue, persisted and flagged in M3)', () => {
    const geoZero = {
      ...baseItem,
      estabelecimento: {
        ...baseItem.estabelecimento,
        endereco: { ...baseItem.estabelecimento.endereco, latitude: 0, longitude: 0 },
      },
    };
    const result = sefazAlPriceResponseSchema.safeParse({
      conteudo: [geoZero],
      pagina: 1,
      primeiraPagina: true,
      registrosPagina: 1,
      registrosPorPagina: 100,
      totalPaginas: 1,
      totalRegistros: 1,
      ultimaPagina: true,
    });
    expect(result.success).toBe(true);
  });

  it('parses an empty response (totalRegistros: 0)', () => {
    const result = sefazAlPriceResponseSchema.safeParse({
      conteudo: [],
      pagina: 1,
      primeiraPagina: true,
      registrosPagina: 0,
      registrosPorPagina: 100,
      totalPaginas: 1,
      totalRegistros: 0,
      ultimaPagina: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when produto.gtin is missing', () => {
    const broken = { ...baseItem, produto: { ...baseItem.produto } };
    delete (broken.produto as { gtin?: string }).gtin;
    const result = sefazAlPriceResponseSchema.safeParse({
      conteudo: [broken],
      pagina: 1,
      primeiraPagina: true,
      registrosPagina: 1,
      registrosPorPagina: 100,
      totalPaginas: 1,
      totalRegistros: 1,
      ultimaPagina: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when codigoIBGE arrives as a string instead of a number', () => {
    const broken = {
      ...baseItem,
      estabelecimento: {
        ...baseItem.estabelecimento,
        endereco: { ...baseItem.estabelecimento.endereco, codigoIBGE: '2704302' },
      },
    };
    const result = sefazAlPriceResponseSchema.safeParse({
      conteudo: [broken],
      pagina: 1,
      primeiraPagina: true,
      registrosPagina: 1,
      registrosPorPagina: 100,
      totalPaginas: 1,
      totalRegistros: 1,
      ultimaPagina: true,
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/sources/sefaz-al/sefaz-al.schemas.test.ts`
Expected: FAIL — cannot find module `./sefaz-al.schemas.js`.

- [ ] **Step 3: Write the schemas**

Write file `src/sources/sefaz-al/sefaz-al.schemas.ts`:

```typescript
import { z } from 'zod';

export const sefazAlVendaSchema = z.object({
  dataVenda: z.string().datetime({ offset: true }),
  valorDeclarado: z.number(),
  valorVenda: z.number(),
});

export const sefazAlProdutoSchema = z.object({
  codigo: z.string(),
  descricao: z.string(),
  descricaoSefaz: z.string().optional(),
  gtin: z.string(),
  ncm: z.string(),
  gpc: z.string(),
  unidadeMedida: z.string(),
  venda: sefazAlVendaSchema,
});

export const sefazAlEnderecoSchema = z.object({
  nomeLogradouro: z.string(),
  numeroImovel: z.string(),
  bairro: z.string(),
  cep: z.string(),
  codigoIBGE: z.number().int(),
  municipio: z.string(),
  latitude: z.number(),
  longitude: z.number(),
});

export const sefazAlEstabelecimentoSchema = z.object({
  cnpj: z.string(),
  razaoSocial: z.string(),
  nomeFantasia: z.string().optional(),
  telefone: z.string().optional(),
  endereco: sefazAlEnderecoSchema,
});

export const sefazAlPriceItemSchema = z.object({
  produto: sefazAlProdutoSchema,
  estabelecimento: sefazAlEstabelecimentoSchema,
});

export const sefazAlPriceResponseSchema = z.object({
  conteudo: z.array(sefazAlPriceItemSchema),
  pagina: z.number().int(),
  primeiraPagina: z.boolean(),
  registrosPagina: z.number().int(),
  registrosPorPagina: z.number().int(),
  totalPaginas: z.number().int(),
  totalRegistros: z.number().int(),
  ultimaPagina: z.boolean(),
});

export type SefazAlVenda = z.infer<typeof sefazAlVendaSchema>;
export type SefazAlProduto = z.infer<typeof sefazAlProdutoSchema>;
export type SefazAlEndereco = z.infer<typeof sefazAlEnderecoSchema>;
export type SefazAlEstabelecimento = z.infer<typeof sefazAlEstabelecimentoSchema>;
export type SefazAlPriceItem = z.infer<typeof sefazAlPriceItemSchema>;
export type SefazAlPriceResponse = z.infer<typeof sefazAlPriceResponseSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/sources/sefaz-al/sefaz-al.schemas.test.ts`
Expected: PASS, 6 tests green.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/sources/sefaz-al/sefaz-al.schemas.ts src/sources/sefaz-al/sefaz-al.schemas.test.ts
git commit -m "feat(sefaz-al): add Zod boundary schemas for /produto/pesquisa response"
```

---

## Task 2: Synthesize MSW fixtures

Build 8 fixture JSONs that mirror the validated SEFAZ AL shape (per `memory/project_sefaz_al_api_spec.md` and the Zod schemas from Task 1). Fixtures are committed to `tests/fixtures/sefaz-al/`. The happy-path fixture (`produto-pesquisa-coca2l-maceio.json`) ships with two items sharing the same `gtin` but different `cnpj`s — a single ingestion run produces 1 canonical `Product` and 2 `Establishment`s, both rows persisted as `first_observation`. The `price_change` and `extended` SCD2 cases are exercised by the repository integration test (Task 12) and the e2e test in M2.3 by replaying the same fixture twice with a mutation between runs; the fixture itself does not need three items.

Synthetic fixtures are explicitly _not_ a substitute for the production-real test that closes M2.3 against the live SEFAZ AL API. They cover unit and integration testing in CI; the real call during M2.3's done-criterion verification proves the full round-trip.

**Files:**

- Create: `tests/fixtures/sefaz-al/produto-pesquisa-coca2l-maceio.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-empty.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-token-invalido.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-gtin-invalido.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-codigoIBGE-string.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-with-descricaoSefaz.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-without-descricaoSefaz.json`
- Create: `tests/fixtures/sefaz-al/produto-pesquisa-geo-zero.json`

- [ ] **Step 1: Create the directory**

Run: `mkdir -p tests/fixtures/sefaz-al`

- [ ] **Step 2: Write `produto-pesquisa-coca2l-maceio.json` (happy path, 2 items)**

Write file `tests/fixtures/sefaz-al/produto-pesquisa-coca2l-maceio.json`:

```json
{
  "conteudo": [
    {
      "produto": {
        "codigo": "C-COCA2L-001",
        "descricao": "REFRIG COCA-COLA 2L PET",
        "descricaoSefaz": "REFRIGERANTE COCA-COLA GARRAFA 2L",
        "gtin": "7894900011517",
        "ncm": "22021000",
        "gpc": "50000000",
        "unidadeMedida": "UN",
        "venda": {
          "dataVenda": "2026-05-11T08:32:11Z",
          "valorDeclarado": 9.99,
          "valorVenda": 8.49
        }
      },
      "estabelecimento": {
        "cnpj": "12345678000100",
        "razaoSocial": "SUPERMERCADO ALFA LTDA",
        "nomeFantasia": "ALFA SUPER",
        "telefone": "8233334444",
        "endereco": {
          "nomeLogradouro": "AV FERNANDES LIMA",
          "numeroImovel": "1500",
          "bairro": "FAROL",
          "cep": "57051000",
          "codigoIBGE": 2704302,
          "municipio": "MACEIO",
          "latitude": -9.6498,
          "longitude": -35.7378
        }
      }
    },
    {
      "produto": {
        "codigo": "C-COCA2L-002",
        "descricao": "COCO-COLA PET 2L",
        "gtin": "7894900011517",
        "ncm": "22021000",
        "gpc": "50000000",
        "unidadeMedida": "UN",
        "venda": {
          "dataVenda": "2026-05-11T09:14:55Z",
          "valorDeclarado": 9.99,
          "valorVenda": 8.99
        }
      },
      "estabelecimento": {
        "cnpj": "98765432000199",
        "razaoSocial": "MERCADO BETA EIRELI",
        "endereco": {
          "nomeLogradouro": "RUA SAO PEDRO",
          "numeroImovel": "350",
          "bairro": "PONTA VERDE",
          "cep": "57035000",
          "codigoIBGE": 2704302,
          "municipio": "MACEIO",
          "latitude": -9.6661,
          "longitude": -35.7203
        }
      }
    }
  ],
  "pagina": 1,
  "primeiraPagina": true,
  "registrosPagina": 2,
  "registrosPorPagina": 100,
  "totalPaginas": 1,
  "totalRegistros": 2,
  "ultimaPagina": true
}
```

- [ ] **Step 3: Write `produto-pesquisa-empty.json`**

Write file `tests/fixtures/sefaz-al/produto-pesquisa-empty.json`:

```json
{
  "conteudo": [],
  "pagina": 1,
  "primeiraPagina": true,
  "registrosPagina": 0,
  "registrosPorPagina": 100,
  "totalPaginas": 1,
  "totalRegistros": 0,
  "ultimaPagina": true
}
```

- [ ] **Step 4: Write `produto-pesquisa-token-invalido.json` (Spring Boot 500 body)**

Write file `tests/fixtures/sefaz-al/produto-pesquisa-token-invalido.json`:

```json
{
  "timestamp": "2026-05-11T10:00:00.000+00:00",
  "status": 500,
  "error": "Internal Server Error",
  "exception": "br.gov.al.sefaz.economiza.api.exception.ApplicationException",
  "message": "Autorização do aplicativo não encontrada",
  "path": "/sfz-economiza-alagoas-api/api/public/produto/pesquisa"
}
```

- [ ] **Step 5: Write `produto-pesquisa-gtin-invalido.json` (HTTP 400 body)**

Write file `tests/fixtures/sefaz-al/produto-pesquisa-gtin-invalido.json`:

```json
{
  "timestamp": "2026-05-11T10:00:00.000+00:00",
  "message": "GTIN inválido"
}
```

- [ ] **Step 6: Write `produto-pesquisa-codigoIBGE-string.json` (HTTP 400 type error)**

Write file `tests/fixtures/sefaz-al/produto-pesquisa-codigoIBGE-string.json`:

```json
{
  "timestamp": "2026-05-11T10:00:00.000+00:00",
  "message": "Tipo inválido para o campo: codigoIBGE"
}
```

- [ ] **Step 7: Write `produto-pesquisa-with-descricaoSefaz.json` (single item, `descricaoSefaz` present)**

Write file `tests/fixtures/sefaz-al/produto-pesquisa-with-descricaoSefaz.json`:

```json
{
  "conteudo": [
    {
      "produto": {
        "codigo": "C-WITH-DESC",
        "descricao": "REFR COCA 2L PT",
        "descricaoSefaz": "REFRIGERANTE COCA-COLA GARRAFA 2L",
        "gtin": "7894900011517",
        "ncm": "22021000",
        "gpc": "50000000",
        "unidadeMedida": "UN",
        "venda": {
          "dataVenda": "2026-05-11T10:00:00Z",
          "valorDeclarado": 9.99,
          "valorVenda": 8.5
        }
      },
      "estabelecimento": {
        "cnpj": "12345678000100",
        "razaoSocial": "SUPERMERCADO ALFA LTDA",
        "endereco": {
          "nomeLogradouro": "AV FERNANDES LIMA",
          "numeroImovel": "1500",
          "bairro": "FAROL",
          "cep": "57051000",
          "codigoIBGE": 2704302,
          "municipio": "MACEIO",
          "latitude": -9.6498,
          "longitude": -35.7378
        }
      }
    }
  ],
  "pagina": 1,
  "primeiraPagina": true,
  "registrosPagina": 1,
  "registrosPorPagina": 100,
  "totalPaginas": 1,
  "totalRegistros": 1,
  "ultimaPagina": true
}
```

- [ ] **Step 8: Write `produto-pesquisa-without-descricaoSefaz.json` (single item, `descricaoSefaz` absent)**

Write file `tests/fixtures/sefaz-al/produto-pesquisa-without-descricaoSefaz.json`:

```json
{
  "conteudo": [
    {
      "produto": {
        "codigo": "C-WITHOUT-DESC",
        "descricao": "COCA COLA REFRI 2L",
        "gtin": "7894900011517",
        "ncm": "22021000",
        "gpc": "50000000",
        "unidadeMedida": "UN",
        "venda": {
          "dataVenda": "2026-05-11T10:00:00Z",
          "valorDeclarado": 9.99,
          "valorVenda": 8.5
        }
      },
      "estabelecimento": {
        "cnpj": "12345678000100",
        "razaoSocial": "SUPERMERCADO ALFA LTDA",
        "endereco": {
          "nomeLogradouro": "AV FERNANDES LIMA",
          "numeroImovel": "1500",
          "bairro": "FAROL",
          "cep": "57051000",
          "codigoIBGE": 2704302,
          "municipio": "MACEIO",
          "latitude": -9.6498,
          "longitude": -35.7378
        }
      }
    }
  ],
  "pagina": 1,
  "primeiraPagina": true,
  "registrosPagina": 1,
  "registrosPorPagina": 100,
  "totalPaginas": 1,
  "totalRegistros": 1,
  "ultimaPagina": true
}
```

- [ ] **Step 9: Write `produto-pesquisa-geo-zero.json` (real data-quality case: lat=0, lng=0)**

Write file `tests/fixtures/sefaz-al/produto-pesquisa-geo-zero.json`:

```json
{
  "conteudo": [
    {
      "produto": {
        "codigo": "C-GEO-ZERO",
        "descricao": "REFRIG COCA-COLA 2L PET",
        "descricaoSefaz": "REFRIGERANTE COCA-COLA GARRAFA 2L",
        "gtin": "7894900011517",
        "ncm": "22021000",
        "gpc": "50000000",
        "unidadeMedida": "UN",
        "venda": {
          "dataVenda": "2026-05-11T10:00:00Z",
          "valorDeclarado": 9.99,
          "valorVenda": 8.5
        }
      },
      "estabelecimento": {
        "cnpj": "11111111000111",
        "razaoSocial": "SUPER VAREJO ATACADO LTDA",
        "endereco": {
          "nomeLogradouro": "AV DESCONHECIDA",
          "numeroImovel": "S/N",
          "bairro": "CENTRO",
          "cep": "57000000",
          "codigoIBGE": 2704302,
          "municipio": "MACEIO",
          "latitude": 0,
          "longitude": 0
        }
      }
    }
  ],
  "pagina": 1,
  "primeiraPagina": true,
  "registrosPagina": 1,
  "registrosPorPagina": 100,
  "totalPaginas": 1,
  "totalRegistros": 1,
  "ultimaPagina": true
}
```

- [ ] **Step 10: Sanity-check the happy-path fixture parses against the Zod schema**

This is a quick smoke check — the fixture must be valid under the schemas from Task 1 or downstream tests will mysteriously fail.

Run:

```bash
node --import @swc-node/register/esm-register -e "
import fs from 'fs';
import { sefazAlPriceResponseSchema } from './src/sources/sefaz-al/sefaz-al.schemas.js';
const raw = JSON.parse(fs.readFileSync('tests/fixtures/sefaz-al/produto-pesquisa-coca2l-maceio.json', 'utf-8'));
const result = sefazAlPriceResponseSchema.safeParse(raw);
if (!result.success) {
  console.error(JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}
console.log('OK:', result.data.totalRegistros, 'items');
"
```

Expected: `OK: 2 items` and exit code 0.

If any fixture fails: read the Zod error path, fix the JSON file in place. Do not relax the schema.

- [ ] **Step 11: Commit**

Run:

```bash
git add tests/fixtures/sefaz-al/
git commit -m "test(fixtures): add synthetic SEFAZ AL fixtures (happy/empty/geo-zero/error bodies)"
```

---

## Task 3: SefazAlClient — TDD with MSW

`SefazAlClient` issues the `POST /produto/pesquisa` request, sends the `AppToken` header, parses the response against `sefazAlPriceResponseSchema`, and either returns the parsed body or throws. M2 only exposes a single method, `fetch({ gtin, municipalityIbgeCode })` — Discovery and Combustível variants are added in later slices.

Tests use MSW to intercept the network call. MSW handlers serve the fixtures from Task 2. The test must verify the request body and the `AppToken` header (this is where the auth contract is enforced) and that the response is parsed via the Zod schema (this is where boundary validation is locked in).

**Files:**

- Create: `tests/helpers/sefaz-msw.ts`
- Create: `src/sources/sefaz-al/sefaz-al.client.ts`
- Create: `src/sources/sefaz-al/sefaz-al.client.test.ts`

- [ ] **Step 1: Create the MSW helper**

Write file `tests/helpers/sefaz-msw.ts`:

```typescript
import { http, HttpResponse, type HttpHandler } from 'msw';
import { setupServer, type SetupServerApi } from 'msw/node';

export const DEFAULT_SEFAZ_BASE_URL =
  'http://api.sefaz.al.gov.br/sfz-economiza-alagoas-api/api/public';

export const createSefazMockServer = (handlers: HttpHandler[] = []): SetupServerApi =>
  setupServer(...handlers);

export const sefazPesquisaUrl = (baseUrl: string = DEFAULT_SEFAZ_BASE_URL): string =>
  `${baseUrl}/produto/pesquisa`;

export const okHandler = (body: unknown, baseUrl: string = DEFAULT_SEFAZ_BASE_URL): HttpHandler =>
  http.post(sefazPesquisaUrl(baseUrl), () => HttpResponse.json(body));

export const errorHandler = (
  status: number,
  body: unknown,
  baseUrl: string = DEFAULT_SEFAZ_BASE_URL,
): HttpHandler => http.post(sefazPesquisaUrl(baseUrl), () => HttpResponse.json(body, { status }));

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
    return HttpResponse.json(body);
  });
```

- [ ] **Step 2: Write the failing test**

Write file `src/sources/sefaz-al/sefaz-al.client.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/sources/sefaz-al/sefaz-al.client.test.ts`
Expected: FAIL — cannot find module `./sefaz-al.client.js`.

- [ ] **Step 4: Implement the client**

Write file `src/sources/sefaz-al/sefaz-al.client.ts`:

```typescript
import axios, { type AxiosInstance } from 'axios';
import { sefazAlPriceResponseSchema, type SefazAlPriceResponse } from './sefaz-al.schemas.js';

export interface SefazAlClientOptions {
  readonly baseUrl: string;
  readonly appToken: string;
  readonly timeoutMs: number;
}

export interface SefazAlFetchQuery {
  readonly gtin: string;
  readonly municipalityIbgeCode: string;
}

export class SefazAlClient {
  private readonly http: AxiosInstance;

  constructor(options: SefazAlClientOptions) {
    this.http = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeoutMs,
      headers: { AppToken: options.appToken, 'Content-Type': 'application/json' },
    });
  }

  async fetch(query: SefazAlFetchQuery): Promise<SefazAlPriceResponse> {
    // The IBGE code is a 7-digit identifier and is kept as a string everywhere internally
    // (CONTEXT.md "Municipality"); SEFAZ AL requires `codigoIBGE` as a JSON number, so the
    // string→number coercion happens only at this boundary.
    const body = {
      produto: { gtin: query.gtin },
      estabelecimento: { municipio: { codigoIBGE: Number(query.municipalityIbgeCode) } },
    };
    const response = await this.http.post('/produto/pesquisa', body);
    return sefazAlPriceResponseSchema.parse(response.data);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/sources/sefaz-al/sefaz-al.client.test.ts`
Expected: PASS, 5 tests green.

- [ ] **Step 6: Commit**

Run:

```bash
git add tests/helpers/sefaz-msw.ts src/sources/sefaz-al/sefaz-al.client.ts src/sources/sefaz-al/sefaz-al.client.test.ts
git commit -m "feat(sefaz-al): add SefazAlClient with AppToken header and Zod boundary parse (TDD)"
```

---

## Task 4: SefazAlAdapter — TDD

`SefazAlAdapter.adapt(item)` translates a `SefazAlPriceItem` into the canonical `RawPriceObservation`. This is a pure function — no I/O, no dependencies — so the test is the simplest in the codebase: assert that the adapter maps each field correctly, including the optional `descricaoSefaz` (carried into `source_canonical_description`), optional `nomeFantasia` and `telefone`, and `dataVenda` parsed into a `Date`.

`source_id` is hardcoded to `'sefaz-al'` inside the adapter, not threaded as a parameter — the adapter exists per source (per ADR-0001).

**Files:**

- Create: `src/sources/sefaz-al/sefaz-al.adapter.ts`
- Create: `src/sources/sefaz-al/sefaz-al.adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Write file `src/sources/sefaz-al/sefaz-al.adapter.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { SefazAlAdapter } from './sefaz-al.adapter.js';
import type { SefazAlPriceItem } from './sefaz-al.schemas.js';

const baseItem: SefazAlPriceItem = {
  produto: {
    codigo: 'C1',
    descricao: 'REFRIG COCA-COLA 2L PET',
    descricaoSefaz: 'REFRIGERANTE COCA-COLA GARRAFA 2L',
    gtin: '7894900011517',
    ncm: '22021000',
    gpc: '50000000',
    unidadeMedida: 'UN',
    venda: {
      dataVenda: '2026-05-11T10:00:00Z',
      valorDeclarado: 9.99,
      valorVenda: 8.49,
    },
  },
  estabelecimento: {
    cnpj: '12345678000100',
    razaoSocial: 'SUPERMERCADO ALFA LTDA',
    nomeFantasia: 'ALFA SUPER',
    telefone: '8233334444',
    endereco: {
      nomeLogradouro: 'AV FERNANDES LIMA',
      numeroImovel: '1500',
      bairro: 'FAROL',
      cep: '57051000',
      codigoIBGE: 2704302,
      municipio: 'MACEIO',
      latitude: -9.6498,
      longitude: -35.7378,
    },
  },
};

describe('SefazAlAdapter.adapt', () => {
  const adapter = new SefazAlAdapter();

  it('maps a complete item into RawPriceObservation', () => {
    const raw = adapter.adapt(baseItem);

    expect(raw.source_id).toBe('sefaz-al');
    expect(raw.gtin).toBe('7894900011517');
    expect(raw.source_canonical_description).toBe('REFRIGERANTE COCA-COLA GARRAFA 2L');
    expect(raw.raw_description).toBe('REFRIG COCA-COLA 2L PET');
    expect(raw.fiscal_code).toBe('22021000');
    expect(raw.category_gpc_code).toBe('50000000');
    expect(raw.unit_of_measure).toBe('UN');
    expect(raw.declared_value).toBe(9.99);
    expect(raw.sale_value).toBe(8.49);
    expect(raw.sold_at.toISOString()).toBe('2026-05-11T10:00:00.000Z');
  });

  it('maps the establishment block including the optional trade_name and converts codigoIBGE to a string', () => {
    const raw = adapter.adapt(baseItem);

    expect(raw.establishment.cnpj).toBe('12345678000100');
    expect(raw.establishment.legal_name).toBe('SUPERMERCADO ALFA LTDA');
    expect(raw.establishment.trade_name).toBe('ALFA SUPER');
    expect(raw.establishment.street).toBe('AV FERNANDES LIMA');
    expect(raw.establishment.street_number).toBe('1500');
    expect(raw.establishment.neighborhood).toBe('FAROL');
    expect(raw.establishment.postal_code).toBe('57051000');
    expect(raw.establishment.municipality_ibge_code).toBe('2704302');
    expect(raw.establishment.municipality_name).toBe('MACEIO');
    expect(raw.establishment.latitude).toBe(-9.6498);
    expect(raw.establishment.longitude).toBe(-35.7378);
  });

  it('returns null for source_canonical_description when descricaoSefaz is absent', () => {
    const withoutSefazDesc: SefazAlPriceItem = {
      ...baseItem,
      produto: { ...baseItem.produto, descricaoSefaz: undefined },
    };
    const raw = adapter.adapt(withoutSefazDesc);
    expect(raw.source_canonical_description).toBeNull();
  });

  it('returns null for trade_name when nomeFantasia is absent', () => {
    const withoutTradeName: SefazAlPriceItem = {
      ...baseItem,
      estabelecimento: { ...baseItem.estabelecimento, nomeFantasia: undefined },
    };
    const raw = adapter.adapt(withoutTradeName);
    expect(raw.establishment.trade_name).toBeNull();
  });

  it('carries through lat=0 and lng=0 (data-quality case persisted in M2; flagged in M3)', () => {
    const geoZero: SefazAlPriceItem = {
      ...baseItem,
      estabelecimento: {
        ...baseItem.estabelecimento,
        endereco: { ...baseItem.estabelecimento.endereco, latitude: 0, longitude: 0 },
      },
    };
    const raw = adapter.adapt(geoZero);
    expect(raw.establishment.latitude).toBe(0);
    expect(raw.establishment.longitude).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/sources/sefaz-al/sefaz-al.adapter.test.ts`
Expected: FAIL — cannot find module `./sefaz-al.adapter.js`.

- [ ] **Step 3: Implement the adapter**

Write file `src/sources/sefaz-al/sefaz-al.adapter.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import type { RawPriceObservation } from '../../ingestion/domain/raw-price-observation.js';
import type { SefazAlPriceItem } from './sefaz-al.schemas.js';

@Injectable()
export class SefazAlAdapter {
  adapt(item: SefazAlPriceItem): RawPriceObservation {
    return {
      source_id: 'sefaz-al',
      gtin: item.produto.gtin,
      source_canonical_description: item.produto.descricaoSefaz ?? null,
      raw_description: item.produto.descricao,
      fiscal_code: item.produto.ncm,
      category_gpc_code: item.produto.gpc,
      unit_of_measure: item.produto.unidadeMedida,
      declared_value: item.produto.venda.valorDeclarado,
      sale_value: item.produto.venda.valorVenda,
      sold_at: new Date(item.produto.venda.dataVenda),
      establishment: {
        cnpj: item.estabelecimento.cnpj,
        legal_name: item.estabelecimento.razaoSocial,
        trade_name: item.estabelecimento.nomeFantasia ?? null,
        street: item.estabelecimento.endereco.nomeLogradouro,
        street_number: item.estabelecimento.endereco.numeroImovel,
        neighborhood: item.estabelecimento.endereco.bairro,
        postal_code: item.estabelecimento.endereco.cep,
        municipality_ibge_code: String(item.estabelecimento.endereco.codigoIBGE),
        municipality_name: item.estabelecimento.endereco.municipio,
        latitude: item.estabelecimento.endereco.latitude,
        longitude: item.estabelecimento.endereco.longitude,
      },
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/sources/sefaz-al/sefaz-al.adapter.test.ts`
Expected: PASS, 5 tests green.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/sources/sefaz-al/sefaz-al.adapter.ts src/sources/sefaz-al/sefaz-al.adapter.test.ts
git commit -m "feat(sefaz-al): add SefazAlAdapter (SefazAlPriceItem → RawPriceObservation, TDD)"
```

---

## Task 5: SefazAlModule wire-up

`SefazAlModule` exports `SefazAlClient` and `SefazAlAdapter` for consumption by `IngestionModule`. The client is built via a `useFactory` because it depends on `ConfigService` (env-driven base URL, AppToken, timeout). `AppConfigModule` is `@Global()` in M1's composition (see `src/shared/config/config.module.ts`), so `ConfigService` is injectable without importing `AppConfigModule` here.

**Files:**

- Create: `src/sources/sefaz-al/sefaz-al.module.ts`

- [ ] **Step 1: Write the module**

Write file `src/sources/sefaz-al/sefaz-al.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/config/env.schema.js';
import { SefazAlAdapter } from './sefaz-al.adapter.js';
import { SefazAlClient } from './sefaz-al.client.js';

@Module({
  providers: [
    {
      provide: SefazAlClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): SefazAlClient =>
        new SefazAlClient({
          baseUrl: config.get('SEFAZ_API_BASE_URL', { infer: true }),
          appToken: config.get('SEFAZ_APP_TOKEN', { infer: true }),
          timeoutMs: config.get('SEFAZ_HTTP_TIMEOUT_MS', { infer: true }),
        }),
    },
    SefazAlAdapter,
  ],
  exports: [SefazAlClient, SefazAlAdapter],
})
export class SefazAlModule {}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits with code 0.

- [ ] **Step 3: Commit**

Run:

```bash
git add src/sources/sefaz-al/sefaz-al.module.ts
git commit -m "feat(sefaz-al): add SefazAlModule wiring client (env-driven) and adapter"
```

---

## Task 6: Validator service — TDD

`Validator.validate(raw)` is a pure function that returns `Result<RawPriceObservation, HardRejection>`. M2 implements exactly 3 rules per spec §8 (geo-invalid and statistical anomalies are deferred to M3). Each rule produces a structured `reason`:

| Rule                     | `reason` value             | Logic                                                        |
| ------------------------ | -------------------------- | ------------------------------------------------------------ |
| GTIN invalid length      | `gtin_invalid_length`      | After stripping leading zeros, `length < 8` or `length > 14` |
| GTIN invalid check digit | `gtin_invalid_check_digit` | GS1 Mod-10 check digit does not validate                     |
| Sale value out of range  | `sale_value_out_of_range`  | `sale_value < 0.01` or `sale_value > 1_000_000`              |

GTIN rules apply only when `raw.gtin !== null`. The Discovery pipeline (M4) is the only place null GTIN currently flows — for M2 (CuratedSeed only) every observation will have `gtin !== null`, but the Validator is written source-agnostically so it can be reused later.

The GS1 Mod-10 check digit algorithm: take the body (digits except the rightmost), reverse it, sum each digit times `3` (even index) or `1` (odd index), the check digit equals `(10 - sum mod 10) mod 10`.

**Files:**

- Create: `src/ingestion/application/validator.service.ts`
- Create: `src/ingestion/application/validator.service.test.ts`

- [ ] **Step 1: Write the failing test**

Write file `src/ingestion/application/validator.service.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';
import { Validator } from './validator.service.js';

const baseRaw: RawPriceObservation = {
  source_id: 'sefaz-al',
  gtin: '7894900011517',
  source_canonical_description: 'REFRIGERANTE COCA-COLA GARRAFA 2L',
  raw_description: 'REFRIG COCA-COLA 2L PET',
  fiscal_code: '22021000',
  category_gpc_code: '50000000',
  unit_of_measure: 'UN',
  declared_value: 9.99,
  sale_value: 8.49,
  sold_at: new Date('2026-05-11T10:00:00Z'),
  establishment: {
    cnpj: '12345678000100',
    legal_name: 'SUPERMERCADO ALFA LTDA',
    trade_name: null,
    street: 'AV TESTE',
    street_number: '100',
    neighborhood: 'CENTRO',
    postal_code: '57000000',
    municipality_ibge_code: '2704302',
    municipality_name: 'MACEIO',
    latitude: -9.66,
    longitude: -35.73,
  },
};

describe('Validator.validate', () => {
  const validator = new Validator();

  it('accepts a fully-valid observation', () => {
    const result = validator.validate(baseRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(baseRaw);
    }
  });

  it('accepts an observation with null gtin (Discovery path)', () => {
    const result = validator.validate({ ...baseRaw, gtin: null });
    expect(result.ok).toBe(true);
  });

  it('rejects when stripped gtin has fewer than 8 digits', () => {
    const result = validator.validate({ ...baseRaw, gtin: '0000000000017' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('gtin_invalid_length');
    }
  });

  it('rejects when stripped gtin has more than 14 digits', () => {
    const result = validator.validate({ ...baseRaw, gtin: '123456789012345' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('gtin_invalid_length');
    }
  });

  it('rejects when GTIN check digit is wrong', () => {
    const result = validator.validate({ ...baseRaw, gtin: '7894900011510' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('gtin_invalid_check_digit');
    }
  });

  it('accepts a valid 8-digit GTIN', () => {
    const result = validator.validate({ ...baseRaw, gtin: '40170725' });
    expect(result.ok).toBe(true);
  });

  it('accepts a valid 14-digit GTIN (DUN-14 case)', () => {
    const result = validator.validate({ ...baseRaw, gtin: '47896006751616' });
    expect(result.ok).toBe(true);
  });

  it('rejects when sale_value is below 0.01', () => {
    const result = validator.validate({ ...baseRaw, sale_value: 0.005 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('sale_value_out_of_range');
    }
  });

  it('rejects when sale_value is above 1_000_000', () => {
    const result = validator.validate({ ...baseRaw, sale_value: 1_000_001 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('sale_value_out_of_range');
    }
  });

  it('rejects on the first failing rule (GTIN length checked before sale value)', () => {
    const result = validator.validate({
      ...baseRaw,
      gtin: '0000000000017',
      sale_value: 0.001,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('gtin_invalid_length');
    }
  });

  it('attaches the raw observation to the HardRejection payload', () => {
    const broken = { ...baseRaw, sale_value: 0 };
    const result = validator.validate(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.raw_payload).toBe(broken);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ingestion/application/validator.service.test.ts`
Expected: FAIL — cannot find module `./validator.service.js`.

- [ ] **Step 3: Implement the validator**

Write file `src/ingestion/application/validator.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { hardRejection, type HardRejection } from '../domain/hard-rejection.js';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';
import { err, ok, type Result } from '../domain/result.js';

const MIN_SALE_VALUE = 0.01;
const MAX_SALE_VALUE = 1_000_000;
const GTIN_MIN_LENGTH = 8;
const GTIN_MAX_LENGTH = 14;

@Injectable()
export class Validator {
  validate(raw: RawPriceObservation): Result<RawPriceObservation, HardRejection> {
    if (raw.gtin !== null) {
      const stripped = raw.gtin.replace(/^0+/, '');
      if (stripped.length < GTIN_MIN_LENGTH || stripped.length > GTIN_MAX_LENGTH) {
        return err(hardRejection('gtin_invalid_length', raw));
      }
      if (!isValidGs1CheckDigit(raw.gtin)) {
        return err(hardRejection('gtin_invalid_check_digit', raw));
      }
    }

    if (raw.sale_value < MIN_SALE_VALUE || raw.sale_value > MAX_SALE_VALUE) {
      return err(hardRejection('sale_value_out_of_range', raw));
    }

    return ok(raw);
  }
}

function isValidGs1CheckDigit(gtin: string): boolean {
  if (!/^\d+$/.test(gtin)) return false;
  const digits = gtin.split('').map(Number);
  const check = digits[digits.length - 1];
  if (check === undefined) return false;
  const body = digits.slice(0, -1).reverse();
  const sum = body.reduce<number>((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  const expected = (10 - (sum % 10)) % 10;
  return expected === check;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ingestion/application/validator.service.test.ts`
Expected: PASS, 11 tests green.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/ingestion/application/validator.service.ts src/ingestion/application/validator.service.test.ts
git commit -m "feat(ingestion): add Validator service with 3 HardRejection rules (TDD)"
```

---

## Task 7: Catalog domain types + module

Catalog entities are POJO types — the persisted shape is already defined by the Drizzle row types (`ProductRow`, `EstablishmentRow`, `ChainRow`). The domain types are a thin re-exposure with stable, source-agnostic names that downstream code can use without leaking ORM details. `Product`, `Establishment`, `Chain` are aliases of the inferred row types for now; they could diverge later (e.g., when adding computed methods or invariants), without forcing callers to change imports.

`CatalogModule` is empty in M2 (no services); it exists to mark the boundary and to be the import surface that future read-side services hang off. Imported by `IngestionModule` (Task 15) so the repositories under `src/ingestion/infrastructure/` can stay grouped with the pipeline while still respecting the feature boundary.

**Files:**

- Create: `src/catalog/domain/product.ts`
- Create: `src/catalog/domain/establishment.ts`
- Create: `src/catalog/domain/chain.ts`
- Create: `src/catalog/catalog.module.ts`

- [ ] **Step 1: Create `product.ts`**

Write file `src/catalog/domain/product.ts`:

```typescript
import type { ProductRow } from '../../shared/db/schema/products.js';

export type Product = ProductRow;
```

- [ ] **Step 2: Create `establishment.ts`**

Write file `src/catalog/domain/establishment.ts`:

```typescript
import type { EstablishmentRow } from '../../shared/db/schema/establishments.js';

export type Establishment = EstablishmentRow;
```

- [ ] **Step 3: Create `chain.ts`**

Write file `src/catalog/domain/chain.ts`:

```typescript
import type { ChainRow } from '../../shared/db/schema/chains.js';

export type Chain = ChainRow;
```

- [ ] **Step 4: Create `catalog.module.ts`**

Write file `src/catalog/catalog.module.ts`:

```typescript
import { Module } from '@nestjs/common';

@Module({})
export class CatalogModule {}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits with code 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/catalog/
git commit -m "feat(catalog): add Product, Establishment, Chain domain types + empty CatalogModule"
```

---

## Task 8: Postgres Testcontainers helper

The Postgres test helper bootstraps an ephemeral container, applies the project's Drizzle migrations against it, returns a Drizzle client, and exposes `truncateAll()` for per-test isolation and `cleanup()` for teardown. Bumping `testTimeout` to `60_000` ms in `vitest.config.ts` ensures container startup does not flake CI runs (Postgres image pull + boot can take 15–25s on a cold cache).

Per-test isolation uses `TRUNCATE … RESTART IDENTITY CASCADE` rather than recreating the schema between tests. TRUNCATE is significantly faster than DROP/CREATE and CASCADE handles FK dependencies in one statement.

**Files:**

- Modify: `vitest.config.ts`
- Create: `tests/helpers/postgres-container.ts`

- [ ] **Step 1: Bump `testTimeout` in `vitest.config.ts`**

Edit `vitest.config.ts`. Add `testTimeout: 60_000,` inside the `test:` block (alongside `globals`, `environment`, etc.):

```typescript
  test: {
    globals: false,
    environment: 'node',
    passWithNoTests: true,
    testTimeout: 60_000,
    include: ['src/**/*.test.ts', 'src/**/*.e2e.test.ts'],
    // ...
```

- [ ] **Step 2: Create the helper**

Write file `tests/helpers/postgres-container.ts`:

```typescript
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import * as schema from '../../src/shared/db/schema/index.js';

export interface PostgresTestContext {
  readonly db: PostgresJsDatabase<typeof schema>;
  readonly url: string;
  readonly truncateAll: () => Promise<void>;
  readonly cleanup: () => Promise<void>;
}

const TRUNCATE_SQL = sql`
  TRUNCATE TABLE
    price_observations,
    ingestion_failures,
    establishments,
    products,
    chains
  RESTART IDENTITY CASCADE
`;

export async function createPostgresTestContext(): Promise<PostgresTestContext> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const url = container.getConnectionUri();

  const migrationClient: Sql = postgres(url, { max: 1 });
  await migrate(drizzle(migrationClient), { migrationsFolder: './drizzle/migrations' });
  await migrationClient.end();

  const queryClient = postgres(url, { max: 5 });
  const db = drizzle(queryClient, { schema });

  return {
    db,
    url,
    truncateAll: async () => {
      await db.execute(TRUNCATE_SQL);
    },
    cleanup: async () => {
      await queryClient.end({ timeout: 5 });
      await stopQuietly(container);
    },
  };
}

async function stopQuietly(container: StartedPostgreSqlContainer): Promise<void> {
  try {
    await container.stop();
  } catch {
    // best-effort cleanup; container may already be stopped during teardown
  }
}
```

- [ ] **Step 3: Smoke-test the helper (manual, one-time)**

Run a quick standalone check that the helper starts a container, applies migrations, and tears down cleanly.

Run:

```bash
docker info > /dev/null 2>&1 && echo "docker OK" || (echo "docker not running" && exit 1)
```

Expected: `docker OK`.

Then:

```bash
node --import @swc-node/register/esm-register -e "
import { createPostgresTestContext } from './tests/helpers/postgres-container.js';
const ctx = await createPostgresTestContext();
console.log('url =', ctx.url);
await ctx.truncateAll();
await ctx.cleanup();
console.log('OK');
"
```

Expected: prints `url = postgres://test:test@localhost:<port>/test` (or similar), then `OK`, then exits 0. Total time on a warm cache: ~15–20s.

- [ ] **Step 4: Commit**

Run:

```bash
git add vitest.config.ts tests/helpers/postgres-container.ts
git commit -m "test(infra): add Postgres testcontainers helper with migrate + truncateAll"
```

---

## Task 9: ProductRepository — integration TDD

`ProductRepository.findOrCreateByGtin(gtin, fillFn)` looks up a product by `gtin`, creating it if absent. `fillFn` returns the additional columns needed when creating a new row (`canonical_description`, `fiscal_code`, `category_gpc_code`). Inside one Postgres transaction the find-or-create is race-safe: a `SELECT … FOR UPDATE` on the partial-unique-indexed lookup serializes concurrent calls.

In M2 only the GTIN path is exercised. A `findOrCreateByFallbackHash` variant for null-GTIN products lands in M4 (Discovery); not implementing it now avoids dead code per spec §1.

**Files:**

- Create: `src/ingestion/infrastructure/product.repository.ts`
- Create: `src/ingestion/infrastructure/product.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Write file `src/ingestion/infrastructure/product.repository.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPostgresTestContext,
  type PostgresTestContext,
} from '../../../tests/helpers/postgres-container.js';
import { ProductRepository } from './product.repository.js';

describe('ProductRepository.findOrCreateByGtin (integration)', () => {
  let ctx: PostgresTestContext;
  let repo: ProductRepository;

  beforeAll(async () => {
    ctx = await createPostgresTestContext();
    repo = new ProductRepository(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await ctx.truncateAll();
  });

  it('creates a product when the GTIN is absent', async () => {
    const product = await repo.findOrCreateByGtin('7894900011517', () => ({
      canonical_description: 'REFRIGERANTE COCA-COLA GARRAFA 2L',
      fiscal_code: '22021000',
      category_gpc_code: '50000000',
    }));

    expect(product.gtin).toBe('7894900011517');
    expect(product.canonical_description).toBe('REFRIGERANTE COCA-COLA GARRAFA 2L');
    expect(product.fiscal_code).toBe('22021000');
  });

  it('returns the existing product when the GTIN is already present', async () => {
    const first = await repo.findOrCreateByGtin('7894900011517', () => ({
      canonical_description: 'first',
      fiscal_code: '22021000',
      category_gpc_code: '50000000',
    }));

    const second = await repo.findOrCreateByGtin('7894900011517', () => {
      throw new Error('fillFn should not be called when the product already exists');
    });

    expect(second.id).toBe(first.id);
    expect(second.canonical_description).toBe('first');
  });

  it('persists distinct rows for different GTINs', async () => {
    const a = await repo.findOrCreateByGtin('7894900011517', () => ({
      canonical_description: 'A',
      fiscal_code: '22021000',
      category_gpc_code: '50000000',
    }));
    const b = await repo.findOrCreateByGtin('40170725', () => ({
      canonical_description: 'B',
      fiscal_code: '21069090',
      category_gpc_code: '50000000',
    }));
    expect(a.id).not.toBe(b.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ingestion/infrastructure/product.repository.test.ts`
Expected: FAIL — cannot find module `./product.repository.js`.

- [ ] **Step 3: Implement the repository**

Write file `src/ingestion/infrastructure/product.repository.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Product } from '../../catalog/domain/product.js';
import type { AppDatabase } from '../../shared/db/client.js';
import { DATABASE } from '../../shared/db/db.module.js';
import { products } from '../../shared/db/schema/products.js';

export interface ProductFillFields {
  readonly canonical_description: string;
  readonly fiscal_code: string;
  readonly category_gpc_code: string;
}

@Injectable()
export class ProductRepository {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}

  async findOrCreateByGtin(gtin: string, fillFn: () => ProductFillFields): Promise<Product> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(products)
        .where(eq(products.gtin, gtin))
        .for('update')
        .limit(1);
      if (existing[0]) return existing[0];

      const fill = fillFn();
      const [inserted] = await tx
        .insert(products)
        .values({
          gtin,
          fallback_hash: null,
          canonical_description: fill.canonical_description,
          fiscal_code: fill.fiscal_code,
          category_gpc_code: fill.category_gpc_code,
        })
        .returning();

      if (!inserted) {
        throw new Error('Insert returned no row');
      }
      return inserted;
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ingestion/infrastructure/product.repository.test.ts`
Expected: PASS, 3 tests green. (Cold cache: ~25s, warm: ~5s.)

- [ ] **Step 5: Commit**

Run:

```bash
git add src/ingestion/infrastructure/product.repository.ts src/ingestion/infrastructure/product.repository.test.ts
git commit -m "feat(ingestion): add ProductRepository.findOrCreateByGtin (integration TDD)"
```

---

## Task 10: EstablishmentRepository — integration TDD

`EstablishmentRepository.findOrCreateByCnpj(cnpj, fillFn)` mirrors `ProductRepository` but on the `cnpj` unique constraint. The `cnpj_root` column is generated by Postgres (M2.1 Task 3); we do not write it. `chain_id` is set to `null` in M2 — chain attachment to non-curated `cnpj_root`s lands in M3 when `config/chains.yaml` is populated.

**Files:**

- Create: `src/ingestion/infrastructure/establishment.repository.ts`
- Create: `src/ingestion/infrastructure/establishment.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Write file `src/ingestion/infrastructure/establishment.repository.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPostgresTestContext,
  type PostgresTestContext,
} from '../../../tests/helpers/postgres-container.js';
import { EstablishmentRepository } from './establishment.repository.js';

const fillFromRaw = () => ({
  legal_name: 'SUPERMERCADO ALFA LTDA',
  trade_name: 'ALFA SUPER',
  street: 'AV FERNANDES LIMA',
  street_number: '1500',
  neighborhood: 'FAROL',
  postal_code: '57051000',
  municipality_ibge_code: '2704302',
  municipality_name: 'MACEIO',
  latitude: -9.6498,
  longitude: -35.7378,
});

describe('EstablishmentRepository.findOrCreateByCnpj (integration)', () => {
  let ctx: PostgresTestContext;
  let repo: EstablishmentRepository;

  beforeAll(async () => {
    ctx = await createPostgresTestContext();
    repo = new EstablishmentRepository(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await ctx.truncateAll();
  });

  it('creates an establishment when the CNPJ is absent', async () => {
    const est = await repo.findOrCreateByCnpj('12345678000100', fillFromRaw);
    expect(est.cnpj).toBe('12345678000100');
    expect(est.cnpj_root).toBe('12345678');
    expect(est.legal_name).toBe('SUPERMERCADO ALFA LTDA');
    expect(est.municipality_ibge_code).toBe('2704302');
    expect(est.chain_id).toBeNull();
  });

  it('returns the existing establishment when the CNPJ is already present', async () => {
    const first = await repo.findOrCreateByCnpj('12345678000100', fillFromRaw);
    const second = await repo.findOrCreateByCnpj('12345678000100', () => {
      throw new Error('fillFn should not be called when the establishment already exists');
    });
    expect(second.id).toBe(first.id);
  });

  it('persists lat=0 and lng=0 verbatim (data-quality case; quality_flag populated in M3)', async () => {
    const est = await repo.findOrCreateByCnpj('11111111000111', () => ({
      ...fillFromRaw(),
      legal_name: 'SUPER VAREJO ATACADO LTDA',
      trade_name: null,
      latitude: 0,
      longitude: 0,
    }));
    expect(est.latitude).toBe(0);
    expect(est.longitude).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ingestion/infrastructure/establishment.repository.test.ts`
Expected: FAIL — cannot find module `./establishment.repository.js`.

- [ ] **Step 3: Implement the repository**

Write file `src/ingestion/infrastructure/establishment.repository.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Establishment } from '../../catalog/domain/establishment.js';
import type { AppDatabase } from '../../shared/db/client.js';
import { DATABASE } from '../../shared/db/db.module.js';
import { establishments } from '../../shared/db/schema/establishments.js';

export interface EstablishmentFillFields {
  readonly legal_name: string;
  readonly trade_name: string | null;
  readonly street: string | null;
  readonly street_number: string | null;
  readonly neighborhood: string;
  readonly postal_code: string | null;
  readonly municipality_ibge_code: string;
  readonly municipality_name: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

@Injectable()
export class EstablishmentRepository {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}

  async findOrCreateByCnpj(
    cnpj: string,
    fillFn: () => EstablishmentFillFields,
  ): Promise<Establishment> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(establishments)
        .where(eq(establishments.cnpj, cnpj))
        .for('update')
        .limit(1);
      if (existing[0]) return existing[0];

      const fill = fillFn();
      const [inserted] = await tx
        .insert(establishments)
        .values({ cnpj, chain_id: null, ...fill })
        .returning();

      if (!inserted) {
        throw new Error('Insert returned no row');
      }
      return inserted;
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ingestion/infrastructure/establishment.repository.test.ts`
Expected: PASS, 3 tests green.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/ingestion/infrastructure/establishment.repository.ts src/ingestion/infrastructure/establishment.repository.test.ts
git commit -m "feat(ingestion): add EstablishmentRepository.findOrCreateByCnpj (integration TDD)"
```

---

## Task 11: IngestionFailureRepository — integration TDD

`IngestionFailureRepository.record(input)` appends one row to `ingestion_failures` for each HardRejection. `raw_payload` is the canonical `RawPriceObservation` (source-agnostic per ADR-0001), serialized verbatim as `jsonb`. `Date` fields serialize to ISO strings, which is acceptable (the payload is for audit and replay, not for downstream querying).

The test asserts the full canonical-payload round-trip — every field of `RawPriceObservation` is preserved through `jsonb` storage. This guards the ADR-0001 source-agnostic guarantee.

**Files:**

- Create: `src/ingestion/infrastructure/ingestion-failure.repository.ts`
- Create: `src/ingestion/infrastructure/ingestion-failure.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Write file `src/ingestion/infrastructure/ingestion-failure.repository.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { desc } from 'drizzle-orm';
import {
  createPostgresTestContext,
  type PostgresTestContext,
} from '../../../tests/helpers/postgres-container.js';
import { ingestionFailures } from '../../shared/db/schema/ingestion-failures.js';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';
import { IngestionFailureRepository } from './ingestion-failure.repository.js';

const buildRaw = (): RawPriceObservation => ({
  source_id: 'sefaz-al',
  gtin: '0000000000017',
  source_canonical_description: null,
  raw_description: 'GTIN PLACEHOLDER',
  fiscal_code: '07133311',
  category_gpc_code: '50000000',
  unit_of_measure: 'KG',
  declared_value: 1.99,
  sale_value: 1.49,
  sold_at: new Date('2026-05-11T10:00:00Z'),
  establishment: {
    cnpj: '12345678000100',
    legal_name: 'TEST',
    trade_name: null,
    street: 'X',
    street_number: '1',
    neighborhood: 'Y',
    postal_code: null,
    municipality_ibge_code: '2704302',
    municipality_name: 'MACEIO',
    latitude: null,
    longitude: null,
  },
});

describe('IngestionFailureRepository.record (integration)', () => {
  let ctx: PostgresTestContext;
  let repo: IngestionFailureRepository;

  beforeAll(async () => {
    ctx = await createPostgresTestContext();
    repo = new IngestionFailureRepository(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await ctx.truncateAll();
  });

  it('persists a row with reason, source_id, and the full canonical raw_payload (round-trip)', async () => {
    const raw = buildRaw();
    await repo.record({ source_id: 'sefaz-al', reason: 'gtin_invalid_length', raw_payload: raw });

    const rows = await ctx.db.select().from(ingestionFailures);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(row.source_id).toBe('sefaz-al');
    expect(row.reason).toBe('gtin_invalid_length');
    // Full canonical-payload round-trip: every top-level field present, nested
    // establishment block intact (per ADR-0001 source-agnostic guarantee).
    const payload = row.raw_payload as Record<string, unknown> & {
      establishment: Record<string, unknown>;
    };
    expect(payload.source_id).toBe('sefaz-al');
    expect(payload.gtin).toBe('0000000000017');
    expect(payload.source_canonical_description).toBeNull();
    expect(payload.raw_description).toBe('GTIN PLACEHOLDER');
    expect(payload.fiscal_code).toBe('07133311');
    expect(payload.category_gpc_code).toBe('50000000');
    expect(payload.unit_of_measure).toBe('KG');
    expect(payload.declared_value).toBe(1.99);
    expect(payload.sale_value).toBe(1.49);
    expect(payload.sold_at).toBe('2026-05-11T10:00:00.000Z'); // Date → ISO string under JSON serialization
    expect(payload.establishment.cnpj).toBe('12345678000100');
    expect(payload.establishment.municipality_ibge_code).toBe('2704302');
  });

  it('persists multiple failures and exposes them ordered by occurred_at desc', async () => {
    const raw = buildRaw();
    await repo.record({ source_id: 'sefaz-al', reason: 'gtin_invalid_length', raw_payload: raw });
    await repo.record({
      source_id: 'sefaz-al',
      reason: 'sale_value_out_of_range',
      raw_payload: raw,
    });

    const rows = await ctx.db
      .select()
      .from(ingestionFailures)
      .orderBy(desc(ingestionFailures.occurred_at));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.reason)).toContain('gtin_invalid_length');
    expect(rows.map((r) => r.reason)).toContain('sale_value_out_of_range');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ingestion/infrastructure/ingestion-failure.repository.test.ts`
Expected: FAIL — cannot find module `./ingestion-failure.repository.js`.

- [ ] **Step 3: Implement the repository**

Write file `src/ingestion/infrastructure/ingestion-failure.repository.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import type { AppDatabase } from '../../shared/db/client.js';
import { DATABASE } from '../../shared/db/db.module.js';
import { ingestionFailures } from '../../shared/db/schema/ingestion-failures.js';
import type { HardRejectionReason } from '../domain/hard-rejection.js';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';

export interface IngestionFailureRecord {
  readonly source_id: string;
  readonly reason: HardRejectionReason;
  readonly raw_payload: RawPriceObservation;
}

@Injectable()
export class IngestionFailureRepository {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}

  async record(input: IngestionFailureRecord): Promise<void> {
    await this.db.insert(ingestionFailures).values({
      source_id: input.source_id,
      reason: input.reason,
      raw_payload: input.raw_payload,
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ingestion/infrastructure/ingestion-failure.repository.test.ts`
Expected: PASS, 2 tests green.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/ingestion/infrastructure/ingestion-failure.repository.ts src/ingestion/infrastructure/ingestion-failure.repository.test.ts
git commit -m "feat(ingestion): add IngestionFailureRepository.record (integration TDD)"
```

---

## Task 12: numeric-scale helper + PriceObservationRepository SCD2 — integration TDD

The SCD2 persist is the load-bearing repository. `persist(input)` implements spec §3.3 inside one Postgres transaction:

- **Case A** — no current row exists for `(product_id, establishment_id)`: INSERT a new row with `fetched_at=now()`, `last_seen_at=now()`, `valid_until='infinity'`. Outcome: `first_observation`.
- **Case B** — current row exists AND `(declared_value, sale_value, sold_at)` match: UPDATE only `last_seen_at = now()`. Outcome: `extended`.
- **Case C** — current row exists AND values differ: UPDATE the old row's `valid_until = now()` (closes it), then INSERT a new row as in Case A. Outcome: `price_change`.

The equality predicate is `(declared_value, sale_value, sold_at)` — `fetched_at` is our wall-clock and is NOT part of the predicate. `numeric` columns round-trip as strings in postgres-js, so the equality check normalizes incoming numbers via `.toFixed(4)`.

The partial UNIQUE index `WHERE valid_until = 'infinity'::timestamptz` (M2.1 Task 4) prevents two concurrent transactions from both inserting a new "current" row for the same `(product_id, establishment_id)`. Combined with `SELECT … FOR UPDATE`, this gives correct behavior under concurrent workers without distributed locks.

This task also extracts `roundToScale(value, scale)` to `src/ingestion/domain/numeric-scale.ts`. The repository uses it for value normalization, and Task 13 (NormalizationService) reuses the same helper to keep the numeric-scale constant defined in exactly one place.

**Caveat for tests:** `valid_until` for the **current** row may be returned by `postgres-js` as the JS number `Infinity` rather than a `Date` — never call `.getTime()` on it. Compare via the SQL predicate `valid_until = 'infinity'::timestamptz` (the test below does this where it inspects closed-row vs current-row state).

**Files:**

- Create: `src/ingestion/domain/numeric-scale.ts`
- Create: `src/ingestion/infrastructure/price-observation.repository.ts`
- Create: `src/ingestion/infrastructure/price-observation.repository.test.ts`

- [ ] **Step 1: Create `numeric-scale.ts`**

Write file `src/ingestion/domain/numeric-scale.ts`:

```typescript
export const NUMERIC_SCALE = 4;

export function roundToScale(value: number, scale: number = NUMERIC_SCALE): number {
  const factor = 10 ** scale;
  return Math.round(value * factor) / factor;
}
```

- [ ] **Step 2: Write the failing test**

Write file `src/ingestion/infrastructure/price-observation.repository.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  createPostgresTestContext,
  type PostgresTestContext,
} from '../../../tests/helpers/postgres-container.js';
import { establishments } from '../../shared/db/schema/establishments.js';
import { priceObservations } from '../../shared/db/schema/price-observations.js';
import { products } from '../../shared/db/schema/products.js';
import { PriceObservationRepository } from './price-observation.repository.js';

describe('PriceObservationRepository.persist (integration, SCD Type 2)', () => {
  let ctx: PostgresTestContext;
  let repo: PriceObservationRepository;
  let productId: string;
  let establishmentId: string;

  beforeAll(async () => {
    ctx = await createPostgresTestContext();
    repo = new PriceObservationRepository(ctx.db);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await ctx.truncateAll();
    const [p] = await ctx.db
      .insert(products)
      .values({
        gtin: '7894900011517',
        fallback_hash: null,
        canonical_description: 'REFRIGERANTE COCA-COLA GARRAFA 2L',
        fiscal_code: '22021000',
        category_gpc_code: '50000000',
      })
      .returning();
    const [e] = await ctx.db
      .insert(establishments)
      .values({
        cnpj: '12345678000100',
        legal_name: 'SUPERMERCADO ALFA LTDA',
        trade_name: null,
        street: null,
        street_number: null,
        neighborhood: 'FAROL',
        postal_code: null,
        municipality_ibge_code: '2704302',
        municipality_name: 'MACEIO',
        latitude: null,
        longitude: null,
        chain_id: null,
      })
      .returning();
    if (!p || !e) throw new Error('seed failed');
    productId = p.id;
    establishmentId = e.id;
  });

  const baseInput = () => ({
    product_id: productId,
    establishment_id: establishmentId,
    declared_value: 9.99,
    sale_value: 8.49,
    sold_at: new Date('2026-05-11T10:00:00Z'),
    source_id: 'sefaz-al',
  });

  it('Case A — first observation: inserts a new row, outcome=first_observation', async () => {
    const result = await repo.persist(baseInput());
    expect(result.outcome).toBe('first_observation');
    expect(result.observation.declared_value).toBe('9.9900');
    expect(result.observation.sale_value).toBe('8.4900');

    const rows = await ctx.db.select().from(priceObservations);
    expect(rows).toHaveLength(1);
  });

  it('Case B — extended: identical re-persist updates last_seen_at only', async () => {
    const first = await repo.persist(baseInput());
    const firstFetchedAt = first.observation.fetched_at;
    const firstLastSeenAt = first.observation.last_seen_at;

    await new Promise((r) => setTimeout(r, 25));

    const second = await repo.persist(baseInput());
    expect(second.outcome).toBe('extended');
    expect(second.observation.id).toBe(first.observation.id);
    expect(second.observation.fetched_at.getTime()).toBe(firstFetchedAt.getTime());
    expect(second.observation.last_seen_at.getTime()).toBeGreaterThan(firstLastSeenAt.getTime());

    const rows = await ctx.db.select().from(priceObservations);
    expect(rows).toHaveLength(1);
  });

  it('Case C — price_change: different sale_value closes old row and inserts new current row', async () => {
    const first = await repo.persist(baseInput());
    await new Promise((r) => setTimeout(r, 25));
    const second = await repo.persist({ ...baseInput(), sale_value: 7.99 });
    expect(second.outcome).toBe('price_change');
    expect(second.observation.id).not.toBe(first.observation.id);

    // Inspect closed row (valid_until set to a real timestamp) via SQL predicate
    // rather than reading the column as a Date — current rows may surface as
    // the literal Infinity.
    const closedRows = await ctx.db
      .select()
      .from(priceObservations)
      .where(sql`valid_until <> 'infinity'::timestamptz`);
    expect(closedRows).toHaveLength(1);
    expect(closedRows[0]?.id).toBe(first.observation.id);

    const currentRows = await ctx.db
      .select()
      .from(priceObservations)
      .where(sql`valid_until = 'infinity'::timestamptz`);
    expect(currentRows).toHaveLength(1);
    expect(currentRows[0]?.id).toBe(second.observation.id);
    expect(currentRows[0]?.sale_value).toBe('7.9900');
  });

  it('Case C — different declared_value also produces price_change', async () => {
    await repo.persist(baseInput());
    const second = await repo.persist({ ...baseInput(), declared_value: 10.99 });
    expect(second.outcome).toBe('price_change');
  });

  it('Case C — different sold_at also produces price_change', async () => {
    await repo.persist(baseInput());
    const second = await repo.persist({
      ...baseInput(),
      sold_at: new Date('2026-05-11T11:00:00Z'),
    });
    expect(second.outcome).toBe('price_change');
  });

  it('current-row partial unique index guarantees exactly one current row per (product, establishment)', async () => {
    await repo.persist(baseInput());
    await repo.persist({ ...baseInput(), sale_value: 7.99 });
    await repo.persist({ ...baseInput(), sale_value: 6.99 });

    const current = await ctx.db
      .select()
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.product_id, productId),
          eq(priceObservations.establishment_id, establishmentId),
          sql`valid_until = 'infinity'::timestamptz`,
        ),
      );
    expect(current).toHaveLength(1);
    expect(current[0]?.sale_value).toBe('6.9900');
  });

  it('different establishments under the same product produce distinct current rows', async () => {
    await repo.persist(baseInput());

    const [e2] = await ctx.db
      .insert(establishments)
      .values({
        cnpj: '98765432000199',
        legal_name: 'MERCADO BETA EIRELI',
        trade_name: null,
        street: null,
        street_number: null,
        neighborhood: 'PONTA VERDE',
        postal_code: null,
        municipality_ibge_code: '2704302',
        municipality_name: 'MACEIO',
        latitude: null,
        longitude: null,
        chain_id: null,
      })
      .returning();
    if (!e2) throw new Error('seed failed');

    const second = await repo.persist({ ...baseInput(), establishment_id: e2.id });
    expect(second.outcome).toBe('first_observation');

    const current = await ctx.db
      .select()
      .from(priceObservations)
      .where(sql`valid_until = 'infinity'::timestamptz`);
    expect(current).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/ingestion/infrastructure/price-observation.repository.test.ts`
Expected: FAIL — cannot find module `./price-observation.repository.js`.

- [ ] **Step 4: Implement the repository**

Write file `src/ingestion/infrastructure/price-observation.repository.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../shared/db/client.js';
import { DATABASE } from '../../shared/db/db.module.js';
import { NUMERIC_SCALE } from '../domain/numeric-scale.js';
import {
  priceObservations,
  type PriceObservationRow,
} from '../../shared/db/schema/price-observations.js';

export interface PersistInput {
  readonly product_id: string;
  readonly establishment_id: string;
  readonly declared_value: number;
  readonly sale_value: number;
  readonly sold_at: Date;
  readonly source_id: string;
}

export type PersistOutcome = 'first_observation' | 'extended' | 'price_change';

export interface PersistResult {
  readonly observation: PriceObservationRow;
  readonly outcome: PersistOutcome;
}

@Injectable()
export class PriceObservationRepository {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}

  async persist(input: PersistInput): Promise<PersistResult> {
    const declaredStr = input.declared_value.toFixed(NUMERIC_SCALE);
    const saleStr = input.sale_value.toFixed(NUMERIC_SCALE);

    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(priceObservations)
        .where(
          and(
            eq(priceObservations.product_id, input.product_id),
            eq(priceObservations.establishment_id, input.establishment_id),
            sql`valid_until = 'infinity'::timestamptz`,
          ),
        )
        .for('update')
        .limit(1);

      const now = new Date();

      if (!current) {
        return {
          observation: await insertNew(tx, input, declaredStr, saleStr, now),
          outcome: 'first_observation',
        };
      }

      const valuesMatch =
        current.declared_value === declaredStr &&
        current.sale_value === saleStr &&
        current.sold_at.getTime() === input.sold_at.getTime();

      if (valuesMatch) {
        const [updated] = await tx
          .update(priceObservations)
          .set({ last_seen_at: now })
          .where(eq(priceObservations.id, current.id))
          .returning();
        if (!updated) throw new Error('Update returned no row');
        return { observation: updated, outcome: 'extended' };
      }

      await tx
        .update(priceObservations)
        .set({ valid_until: now })
        .where(eq(priceObservations.id, current.id));
      return {
        observation: await insertNew(tx, input, declaredStr, saleStr, now),
        outcome: 'price_change',
      };
    });
  }
}

async function insertNew(
  tx: Parameters<Parameters<AppDatabase['transaction']>[0]>[0],
  input: PersistInput,
  declaredStr: string,
  saleStr: string,
  now: Date,
): Promise<PriceObservationRow> {
  const [inserted] = await tx
    .insert(priceObservations)
    .values({
      product_id: input.product_id,
      establishment_id: input.establishment_id,
      fetched_at: now,
      last_seen_at: now,
      sold_at: input.sold_at,
      declared_value: declaredStr,
      sale_value: saleStr,
      source_id: input.source_id,
    })
    .returning();
  if (!inserted) throw new Error('Insert returned no row');
  return inserted;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/ingestion/infrastructure/price-observation.repository.test.ts`
Expected: PASS, 7 tests green.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/ingestion/domain/numeric-scale.ts src/ingestion/infrastructure/price-observation.repository.ts src/ingestion/infrastructure/price-observation.repository.test.ts
git commit -m "feat(ingestion): add numeric-scale helper + PriceObservationRepository SCD2 (TDD)"
```

---

## Task 13: NormalizationService — TDD (mocked repositories)

`NormalizationService.normalize(raw, jobContext)` runs steps a–e from spec §3.3 in order:

1. **Cross-pollution defense (CuratedSeed only)** — when `jobContext.kind === 'curated_seed'` and `raw.gtin !== jobContext.queriedGtin`, return `{ skipped: true, reason: 'cross_pollution' }`. Discovery jobs (`kind === 'discovery'`) do NOT apply this filter.
2. **Find-or-create Product** by GTIN. `canonical_description` selection: prefer `raw.source_canonical_description` (the SEFAZ `descricaoSefaz`) when present, fall back to `raw.raw_description`. Fiscal code and GPC come directly from the raw.
3. **Find-or-create Establishment** by CNPJ. Fill fields come straight from `raw.establishment`.
4. **Round prices** to 4 decimal places (`roundToScale` from Task 12). The repository also rounds defensively, but normalizing in-memory makes the downstream contract clearer.

The return contract is `{ skipped: false; data: NormalizedObservation }` where `NormalizedObservation` exposes `product_id: string` (not the full `Product` entity) — the orchestrator (Task 14) only needs the ID, so propagating the whole row would couple unrelated layers. If a downstream consumer eventually needs the full entity, it can call `ProductRepository` again or this contract can be widened with explicit justification.

**Files:**

- Create: `src/ingestion/application/normalization.service.ts`
- Create: `src/ingestion/application/normalization.service.test.ts`

- [ ] **Step 1: Write the failing test**

Write file `src/ingestion/application/normalization.service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Establishment } from '../../catalog/domain/establishment.js';
import type { Product } from '../../catalog/domain/product.js';
import { EstablishmentRepository } from '../infrastructure/establishment.repository.js';
import { ProductRepository } from '../infrastructure/product.repository.js';
import type { JobContext } from '../domain/job-context.js';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';
import { NormalizationService } from './normalization.service.js';

const stubProduct: Product = {
  id: 'p-1',
  gtin: '7894900011517',
  fallback_hash: null,
  canonical_description: 'REFRIGERANTE COCA-COLA GARRAFA 2L',
  fiscal_code: '22021000',
  category_gpc_code: '50000000',
  created_at: new Date('2026-05-11T00:00:00Z'),
  updated_at: new Date('2026-05-11T00:00:00Z'),
};

const stubEstablishment: Establishment = {
  id: 'e-1',
  cnpj: '12345678000100',
  cnpj_root: '12345678',
  legal_name: 'SUPERMERCADO ALFA LTDA',
  trade_name: null,
  street: null,
  street_number: null,
  neighborhood: 'FAROL',
  postal_code: null,
  municipality_ibge_code: '2704302',
  municipality_name: 'MACEIO',
  latitude: null,
  longitude: null,
  chain_id: null,
  created_at: new Date('2026-05-11T00:00:00Z'),
  updated_at: new Date('2026-05-11T00:00:00Z'),
};

const buildRaw = (overrides: Partial<RawPriceObservation> = {}): RawPriceObservation => ({
  source_id: 'sefaz-al',
  gtin: '7894900011517',
  source_canonical_description: 'REFRIGERANTE COCA-COLA GARRAFA 2L',
  raw_description: 'REFRIG COCA-COLA 2L PET',
  fiscal_code: '22021000',
  category_gpc_code: '50000000',
  unit_of_measure: 'UN',
  declared_value: 9.99,
  sale_value: 8.4949,
  sold_at: new Date('2026-05-11T10:00:00Z'),
  establishment: {
    cnpj: '12345678000100',
    legal_name: 'SUPERMERCADO ALFA LTDA',
    trade_name: null,
    street: null,
    street_number: null,
    neighborhood: 'FAROL',
    postal_code: null,
    municipality_ibge_code: '2704302',
    municipality_name: 'MACEIO',
    latitude: null,
    longitude: null,
  },
  ...overrides,
});

describe('NormalizationService.normalize', () => {
  let productRepo: { findOrCreateByGtin: ReturnType<typeof vi.fn> };
  let establishmentRepo: { findOrCreateByCnpj: ReturnType<typeof vi.fn> };
  let svc: NormalizationService;

  beforeEach(() => {
    productRepo = { findOrCreateByGtin: vi.fn().mockResolvedValue(stubProduct) };
    establishmentRepo = { findOrCreateByCnpj: vi.fn().mockResolvedValue(stubEstablishment) };
    svc = new NormalizationService(
      productRepo as unknown as ProductRepository,
      establishmentRepo as unknown as EstablishmentRepository,
    );
  });

  const curatedJob = (gtin: string): JobContext => ({ kind: 'curated_seed', queriedGtin: gtin });
  const discoveryJob = (): JobContext => ({ kind: 'discovery' });

  it('returns { skipped: true, cross_pollution } when curated job sees a different gtin', async () => {
    const raw = buildRaw({ gtin: '0000000000017' });
    const result = await svc.normalize(raw, curatedJob('7894900011517'));
    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.reason).toBe('cross_pollution');
    }
    expect(productRepo.findOrCreateByGtin).not.toHaveBeenCalled();
    expect(establishmentRepo.findOrCreateByCnpj).not.toHaveBeenCalled();
  });

  it('passes through when curated job sees the queried gtin', async () => {
    const raw = buildRaw();
    const result = await svc.normalize(raw, curatedJob('7894900011517'));
    expect(result.skipped).toBe(false);
  });

  it('does NOT apply cross-pollution check for discovery jobs', async () => {
    const raw = buildRaw({ gtin: '9999999999999' });
    const result = await svc.normalize(raw, discoveryJob());
    expect(result.skipped).toBe(false);
  });

  it('uses source_canonical_description when present in product fill', async () => {
    const raw = buildRaw();
    await svc.normalize(raw, curatedJob('7894900011517'));
    const fillFn = productRepo.findOrCreateByGtin.mock.calls[0]?.[1] as () => {
      canonical_description: string;
    };
    expect(fillFn().canonical_description).toBe('REFRIGERANTE COCA-COLA GARRAFA 2L');
  });

  it('falls back to raw_description when source_canonical_description is null', async () => {
    const raw = buildRaw({ source_canonical_description: null });
    await svc.normalize(raw, curatedJob('7894900011517'));
    const fillFn = productRepo.findOrCreateByGtin.mock.calls[0]?.[1] as () => {
      canonical_description: string;
    };
    expect(fillFn().canonical_description).toBe('REFRIG COCA-COLA 2L PET');
  });

  it('rounds sale_value and declared_value to 4 decimal places', async () => {
    const raw = buildRaw({ sale_value: 5.889877086039772, declared_value: 9.991234567 });
    const result = await svc.normalize(raw, curatedJob('7894900011517'));
    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      expect(result.data.sale_value).toBe(5.8899);
      expect(result.data.declared_value).toBe(9.9912);
    }
  });

  it('returns resolved product_id and establishment_id (not the full entities)', async () => {
    const raw = buildRaw();
    const result = await svc.normalize(raw, curatedJob('7894900011517'));
    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      expect(result.data.product_id).toBe(stubProduct.id);
      expect(result.data.establishment_id).toBe(stubEstablishment.id);
      expect(result.data.source_id).toBe('sefaz-al');
      expect(result.data.sold_at).toEqual(new Date('2026-05-11T10:00:00Z'));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ingestion/application/normalization.service.test.ts`
Expected: FAIL — cannot find module `./normalization.service.js`.

- [ ] **Step 3: Implement the service**

Write file `src/ingestion/application/normalization.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { roundToScale } from '../domain/numeric-scale.js';
import {
  EstablishmentRepository,
  type EstablishmentFillFields,
} from '../infrastructure/establishment.repository.js';
import { ProductRepository, type ProductFillFields } from '../infrastructure/product.repository.js';
import type { JobContext } from '../domain/job-context.js';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';

export interface NormalizedObservation {
  readonly product_id: string;
  readonly establishment_id: string;
  readonly declared_value: number;
  readonly sale_value: number;
  readonly sold_at: Date;
  readonly source_id: string;
}

export type NormalizationResult =
  | { readonly skipped: true; readonly reason: 'cross_pollution' }
  | { readonly skipped: false; readonly data: NormalizedObservation };

@Injectable()
export class NormalizationService {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly establishmentRepo: EstablishmentRepository,
  ) {}

  async normalize(raw: RawPriceObservation, jobContext: JobContext): Promise<NormalizationResult> {
    if (this.isCrossPollution(raw, jobContext)) {
      return { skipped: true, reason: 'cross_pollution' };
    }

    if (raw.gtin === null) {
      throw new Error('NormalizationService: null-gtin path is reserved for Discovery (M4).');
    }

    const product = await this.productRepo.findOrCreateByGtin(raw.gtin, () =>
      this.productFill(raw),
    );
    const establishment = await this.establishmentRepo.findOrCreateByCnpj(
      raw.establishment.cnpj,
      () => this.establishmentFill(raw),
    );

    return {
      skipped: false,
      data: {
        product_id: product.id,
        establishment_id: establishment.id,
        declared_value: roundToScale(raw.declared_value),
        sale_value: roundToScale(raw.sale_value),
        sold_at: raw.sold_at,
        source_id: raw.source_id,
      },
    };
  }

  private isCrossPollution(raw: RawPriceObservation, jobContext: JobContext): boolean {
    return jobContext.kind === 'curated_seed' && raw.gtin !== jobContext.queriedGtin;
  }

  private productFill(raw: RawPriceObservation): ProductFillFields {
    return {
      canonical_description: raw.source_canonical_description ?? raw.raw_description,
      fiscal_code: raw.fiscal_code,
      category_gpc_code: raw.category_gpc_code,
    };
  }

  private establishmentFill(raw: RawPriceObservation): EstablishmentFillFields {
    return {
      legal_name: raw.establishment.legal_name,
      trade_name: raw.establishment.trade_name,
      street: raw.establishment.street,
      street_number: raw.establishment.street_number,
      neighborhood: raw.establishment.neighborhood,
      postal_code: raw.establishment.postal_code,
      municipality_ibge_code: raw.establishment.municipality_ibge_code,
      municipality_name: raw.establishment.municipality_name,
      latitude: raw.establishment.latitude,
      longitude: raw.establishment.longitude,
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ingestion/application/normalization.service.test.ts`
Expected: PASS, 7 tests green.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/ingestion/application/normalization.service.ts src/ingestion/application/normalization.service.test.ts
git commit -m "feat(ingestion): add NormalizationService (cross-pollution, find-or-create, price rounding, TDD)"
```

---

## Task 14: IngestionPipeline bundle + IngestionService orchestrator — TDD (mocked deps)

`IngestionService.ingest(query)` orchestrates the 8-verb pipeline. Per spec §3.3 each response item is processed independently — one item failing does not abort the rest.

The orchestrator has six logical collaborators (client, adapter, validator, normalization, two repositories, event emitter). The ESLint Tier S rule `max-params: 4` enforces that no constructor takes more than four arguments. We bundle the four application-side collaborators (`Validator`, `NormalizationService`, `PriceObservationRepository`, `IngestionFailureRepository`) inside a thin `IngestionPipeline` provider — itself with exactly four constructor params — and inject that bundle into `IngestionService`. The transport-side collaborators (`SefazAlClient`, `SefazAlAdapter`) plus `EventEmitter2` complete the four `IngestionService` constructor params. Bundle members are exposed as `readonly` fields so call sites read like `this.pipeline.validator.validate(raw)` — no extra indirection beyond a property access.

Event-emit policy:

| Pipeline outcome                               | Event emitted                                                  |
| ---------------------------------------------- | -------------------------------------------------------------- |
| Validator returns `Err(HardRejection)`         | `IngestionRejected` (plus row persisted to ingestion_failures) |
| Normalization returns `{ skipped: true }`      | none (internal pipeline concern, not a domain fact)            |
| Persist returns `outcome: 'first_observation'` | `PriceObservationCreated { kind: 'first_observation' }`        |
| Persist returns `outcome: 'price_change'`      | `PriceObservationCreated { kind: 'price_change' }`             |
| Persist returns `outcome: 'extended'`          | `PriceObservationExtended`                                     |

`JobContext` is built inside the orchestrator from the query — M2 only enqueues CuratedSeed jobs, so `kind: 'curated_seed'` and `queriedGtin: query.gtin`. Discovery (M4) will instantiate this differently.

**Files:**

- Create: `src/ingestion/application/ingestion-pipeline.ts`
- Create: `src/ingestion/application/ingestion.service.ts`
- Create: `src/ingestion/application/ingestion.service.test.ts`

- [ ] **Step 1: Create the `IngestionPipeline` bundle**

Write file `src/ingestion/application/ingestion-pipeline.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { IngestionFailureRepository } from '../infrastructure/ingestion-failure.repository.js';
import { PriceObservationRepository } from '../infrastructure/price-observation.repository.js';
import { NormalizationService } from './normalization.service.js';
import { Validator } from './validator.service.js';

@Injectable()
export class IngestionPipeline {
  constructor(
    readonly validator: Validator,
    readonly normalization: NormalizationService,
    readonly priceRepo: PriceObservationRepository,
    readonly failureRepo: IngestionFailureRepository,
  ) {}
}
```

- [ ] **Step 2: Write the failing test**

Write file `src/ingestion/application/ingestion.service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { SefazAlAdapter } from '../../sources/sefaz-al/sefaz-al.adapter.js';
import { SefazAlClient } from '../../sources/sefaz-al/sefaz-al.client.js';
import type {
  SefazAlPriceItem,
  SefazAlPriceResponse,
} from '../../sources/sefaz-al/sefaz-al.schemas.js';
import {
  EVENT_INGESTION_REJECTED,
  EVENT_PRICE_OBSERVATION_CREATED,
  EVENT_PRICE_OBSERVATION_EXTENDED,
} from '../domain/events.js';
import { hardRejection } from '../domain/hard-rejection.js';
import { err, ok } from '../domain/result.js';
import type { RawPriceObservation } from '../domain/raw-price-observation.js';
import { IngestionPipeline } from './ingestion-pipeline.js';
import { IngestionService } from './ingestion.service.js';

// Placeholder item — the adapter is mocked, so the orchestrator never reads
// the inner shape; only the count and identity of items matter.
const buildItem = (gtin: string): SefazAlPriceItem =>
  ({
    produto: { gtin } as unknown,
    estabelecimento: {} as unknown,
  }) as unknown as SefazAlPriceItem;

const buildRaw = (gtin: string, sale: number): RawPriceObservation => ({
  source_id: 'sefaz-al',
  gtin,
  source_canonical_description: null,
  raw_description: 'X',
  fiscal_code: '22021000',
  category_gpc_code: '50000000',
  unit_of_measure: 'UN',
  declared_value: sale + 1,
  sale_value: sale,
  sold_at: new Date('2026-05-11T10:00:00Z'),
  establishment: {
    cnpj: '12345678000100',
    legal_name: 'X',
    trade_name: null,
    street: null,
    street_number: null,
    neighborhood: 'X',
    postal_code: null,
    municipality_ibge_code: '2704302',
    municipality_name: 'MACEIO',
    latitude: null,
    longitude: null,
  },
});

const buildResponse = (items: SefazAlPriceItem[]): SefazAlPriceResponse => ({
  conteudo: items,
  pagina: 1,
  primeiraPagina: true,
  registrosPagina: items.length,
  registrosPorPagina: 100,
  totalPaginas: 1,
  totalRegistros: items.length,
  ultimaPagina: true,
});

describe('IngestionService.ingest', () => {
  let client: { fetch: ReturnType<typeof vi.fn> };
  let adapter: { adapt: ReturnType<typeof vi.fn> };
  let validator: { validate: ReturnType<typeof vi.fn> };
  let normalization: { normalize: ReturnType<typeof vi.fn> };
  let priceRepo: { persist: ReturnType<typeof vi.fn> };
  let failureRepo: { record: ReturnType<typeof vi.fn> };
  let pipeline: IngestionPipeline;
  let events: { emit: ReturnType<typeof vi.fn> };
  let svc: IngestionService;

  beforeEach(() => {
    client = { fetch: vi.fn() };
    adapter = { adapt: vi.fn() };
    validator = { validate: vi.fn() };
    normalization = { normalize: vi.fn() };
    priceRepo = { persist: vi.fn() };
    failureRepo = { record: vi.fn().mockResolvedValue(undefined) };
    events = { emit: vi.fn() };
    pipeline = {
      validator,
      normalization,
      priceRepo,
      failureRepo,
    } as unknown as IngestionPipeline;
    svc = new IngestionService(
      client as unknown as SefazAlClient,
      adapter as unknown as SefazAlAdapter,
      pipeline,
      events as unknown as EventEmitter2,
    );
  });

  it('returns all-zero result for an empty response', async () => {
    client.fetch.mockResolvedValue(buildResponse([]));
    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });
    expect(result).toEqual({
      fetched: 0,
      persisted: 0,
      extended: 0,
      rejected: 0,
      skipped: 0,
    });
  });

  it('persists two first_observations and emits two PriceObservationCreated events', async () => {
    const item1 = buildItem('7894900011517');
    const item2 = buildItem('7894900011517');
    const raw1 = buildRaw('7894900011517', 8.49);
    const raw2 = buildRaw('7894900011517', 8.99);
    client.fetch.mockResolvedValue(buildResponse([item1, item2]));
    adapter.adapt.mockReturnValueOnce(raw1).mockReturnValueOnce(raw2);
    validator.validate.mockImplementation(ok);
    normalization.normalize
      .mockResolvedValueOnce({
        skipped: false,
        data: {
          product_id: 'p-1',
          establishment_id: 'e-1',
          declared_value: 9.49,
          sale_value: 8.49,
          sold_at: raw1.sold_at,
          source_id: 'sefaz-al',
        },
      })
      .mockResolvedValueOnce({
        skipped: false,
        data: {
          product_id: 'p-1',
          establishment_id: 'e-2',
          declared_value: 9.99,
          sale_value: 8.99,
          sold_at: raw2.sold_at,
          source_id: 'sefaz-al',
        },
      });
    priceRepo.persist
      .mockResolvedValueOnce({ observation: { id: 'o-1' }, outcome: 'first_observation' })
      .mockResolvedValueOnce({ observation: { id: 'o-2' }, outcome: 'first_observation' });

    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });

    expect(result).toEqual({
      fetched: 2,
      persisted: 2,
      extended: 0,
      rejected: 0,
      skipped: 0,
    });
    expect(events.emit).toHaveBeenCalledWith(
      EVENT_PRICE_OBSERVATION_CREATED,
      expect.objectContaining({ observation_id: 'o-1', kind: 'first_observation' }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      EVENT_PRICE_OBSERVATION_CREATED,
      expect.objectContaining({ observation_id: 'o-2', kind: 'first_observation' }),
    );
  });

  it('records HardRejection in ingestion_failures and emits IngestionRejected', async () => {
    const item = buildItem('0000000000017');
    const raw = buildRaw('0000000000017', 1.99);
    client.fetch.mockResolvedValue(buildResponse([item]));
    adapter.adapt.mockReturnValue(raw);
    validator.validate.mockReturnValue(err(hardRejection('gtin_invalid_length', raw)));

    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });

    expect(result).toEqual({
      fetched: 1,
      persisted: 0,
      extended: 0,
      rejected: 1,
      skipped: 0,
    });
    expect(failureRepo.record).toHaveBeenCalledWith({
      source_id: 'sefaz-al',
      reason: 'gtin_invalid_length',
      raw_payload: raw,
    });
    expect(events.emit).toHaveBeenCalledWith(
      EVENT_INGESTION_REJECTED,
      expect.objectContaining({ reason: 'gtin_invalid_length', source_id: 'sefaz-al' }),
    );
    expect(normalization.normalize).not.toHaveBeenCalled();
    expect(priceRepo.persist).not.toHaveBeenCalled();
  });

  it('skipped item (cross_pollution) increments only the skipped counter and emits no event', async () => {
    const item = buildItem('9999999999999');
    const raw = buildRaw('9999999999999', 5.0);
    client.fetch.mockResolvedValue(buildResponse([item]));
    adapter.adapt.mockReturnValue(raw);
    validator.validate.mockReturnValue(ok(raw));
    normalization.normalize.mockResolvedValue({ skipped: true, reason: 'cross_pollution' });

    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });

    expect(result).toEqual({
      fetched: 1,
      persisted: 0,
      extended: 0,
      rejected: 0,
      skipped: 1,
    });
    expect(priceRepo.persist).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('extended outcome emits PriceObservationExtended and bumps the extended counter', async () => {
    const item = buildItem('7894900011517');
    const raw = buildRaw('7894900011517', 8.49);
    client.fetch.mockResolvedValue(buildResponse([item]));
    adapter.adapt.mockReturnValue(raw);
    validator.validate.mockReturnValue(ok(raw));
    normalization.normalize.mockResolvedValue({
      skipped: false,
      data: {
        product_id: 'p-1',
        establishment_id: 'e-1',
        declared_value: 9.49,
        sale_value: 8.49,
        sold_at: raw.sold_at,
        source_id: 'sefaz-al',
      },
    });
    priceRepo.persist.mockResolvedValue({ observation: { id: 'o-1' }, outcome: 'extended' });

    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });

    expect(result.extended).toBe(1);
    expect(events.emit).toHaveBeenCalledWith(
      EVENT_PRICE_OBSERVATION_EXTENDED,
      expect.objectContaining({ observation_id: 'o-1' }),
    );
  });

  it('price_change outcome emits PriceObservationCreated with kind=price_change', async () => {
    const item = buildItem('7894900011517');
    const raw = buildRaw('7894900011517', 7.99);
    client.fetch.mockResolvedValue(buildResponse([item]));
    adapter.adapt.mockReturnValue(raw);
    validator.validate.mockReturnValue(ok(raw));
    normalization.normalize.mockResolvedValue({
      skipped: false,
      data: {
        product_id: 'p-1',
        establishment_id: 'e-1',
        declared_value: 8.99,
        sale_value: 7.99,
        sold_at: raw.sold_at,
        source_id: 'sefaz-al',
      },
    });
    priceRepo.persist.mockResolvedValue({ observation: { id: 'o-2' }, outcome: 'price_change' });

    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });

    expect(result.persisted).toBe(1);
    expect(events.emit).toHaveBeenCalledWith(
      EVENT_PRICE_OBSERVATION_CREATED,
      expect.objectContaining({ kind: 'price_change' }),
    );
  });

  it('continues processing remaining items when one rejection occurs mid-loop', async () => {
    const itemGood = buildItem('7894900011517');
    const itemBad = buildItem('0000000000017');
    const rawGood = buildRaw('7894900011517', 8.49);
    const rawBad = buildRaw('0000000000017', 5.0);
    client.fetch.mockResolvedValue(buildResponse([itemBad, itemGood]));
    adapter.adapt.mockReturnValueOnce(rawBad).mockReturnValueOnce(rawGood);
    validator.validate
      .mockReturnValueOnce(err(hardRejection('gtin_invalid_length', rawBad)))
      .mockReturnValueOnce(ok(rawGood));
    normalization.normalize.mockResolvedValue({
      skipped: false,
      data: {
        product_id: 'p-1',
        establishment_id: 'e-1',
        declared_value: 9.49,
        sale_value: 8.49,
        sold_at: rawGood.sold_at,
        source_id: 'sefaz-al',
      },
    });
    priceRepo.persist.mockResolvedValue({
      observation: { id: 'o-good' },
      outcome: 'first_observation',
    });

    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });
    expect(result).toEqual({
      fetched: 2,
      persisted: 1,
      extended: 0,
      rejected: 1,
      skipped: 0,
    });
  });

  it('invariant: fetched = persisted + extended + rejected + skipped', async () => {
    client.fetch.mockResolvedValue(buildResponse([]));
    const result = await svc.ingest({ gtin: '7894900011517', municipalityIbgeCode: '2704302' });
    expect(result.fetched).toBe(
      result.persisted + result.extended + result.rejected + result.skipped,
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/ingestion/application/ingestion.service.test.ts`
Expected: FAIL — cannot find module `./ingestion.service.js`.

- [ ] **Step 4: Implement the orchestrator**

Write file `src/ingestion/application/ingestion.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SefazAlAdapter } from '../../sources/sefaz-al/sefaz-al.adapter.js';
import { SefazAlClient } from '../../sources/sefaz-al/sefaz-al.client.js';
import type { SefazAlPriceItem } from '../../sources/sefaz-al/sefaz-al.schemas.js';
import {
  EVENT_INGESTION_REJECTED,
  EVENT_PRICE_OBSERVATION_CREATED,
  EVENT_PRICE_OBSERVATION_EXTENDED,
} from '../domain/events.js';
import type { HardRejection } from '../domain/hard-rejection.js';
import { emptyIngestionResult, type IngestionResult } from '../domain/ingestion-result.js';
import type { JobContext } from '../domain/job-context.js';
import type { PersistResult } from '../infrastructure/price-observation.repository.js';
import { IngestionPipeline } from './ingestion-pipeline.js';
import type { NormalizationResult } from './normalization.service.js';

export interface IngestionQuery {
  readonly gtin: string;
  readonly municipalityIbgeCode: string;
}

@Injectable()
export class IngestionService {
  constructor(
    private readonly client: SefazAlClient,
    private readonly adapter: SefazAlAdapter,
    private readonly pipeline: IngestionPipeline,
    private readonly events: EventEmitter2,
  ) {}

  async ingest(query: IngestionQuery): Promise<IngestionResult> {
    const response = await this.client.fetch(query);
    const jobContext: JobContext = { kind: 'curated_seed', queriedGtin: query.gtin };

    let acc: IngestionResult = { ...emptyIngestionResult(), fetched: response.conteudo.length };
    for (const item of response.conteudo) {
      acc = await this.processOne(item, jobContext, acc);
    }
    return acc;
  }

  private async processOne(
    item: SefazAlPriceItem,
    jobContext: JobContext,
    acc: IngestionResult,
  ): Promise<IngestionResult> {
    const raw = this.adapter.adapt(item);
    const validated = this.pipeline.validator.validate(raw);

    if (!validated.ok) {
      await this.recordRejection(validated.error);
      return { ...acc, rejected: acc.rejected + 1 };
    }

    const normalized = await this.pipeline.normalization.normalize(validated.value, jobContext);
    if (normalized.skipped) {
      return { ...acc, skipped: acc.skipped + 1 };
    }

    const persisted = await this.pipeline.priceRepo.persist({
      product_id: normalized.data.product_id,
      establishment_id: normalized.data.establishment_id,
      declared_value: normalized.data.declared_value,
      sale_value: normalized.data.sale_value,
      sold_at: normalized.data.sold_at,
      source_id: normalized.data.source_id,
    });

    this.emitPersistEvent(persisted, normalized);
    return persisted.outcome === 'extended'
      ? { ...acc, extended: acc.extended + 1 }
      : { ...acc, persisted: acc.persisted + 1 };
  }

  private async recordRejection(rejection: HardRejection): Promise<void> {
    await this.pipeline.failureRepo.record({
      source_id: rejection.raw_payload.source_id,
      reason: rejection.reason,
      raw_payload: rejection.raw_payload,
    });
    this.events.emit(EVENT_INGESTION_REJECTED, {
      source_id: rejection.raw_payload.source_id,
      reason: rejection.reason,
      raw_payload: rejection.raw_payload,
    });
  }

  private emitPersistEvent(
    result: PersistResult,
    normalized: Extract<NormalizationResult, { skipped: false }>,
  ): void {
    const base = {
      observation_id: result.observation.id,
      product_id: normalized.data.product_id,
      establishment_id: normalized.data.establishment_id,
      source_id: normalized.data.source_id,
    };
    if (result.outcome === 'extended') {
      this.events.emit(EVENT_PRICE_OBSERVATION_EXTENDED, base);
    } else {
      this.events.emit(EVENT_PRICE_OBSERVATION_CREATED, { ...base, kind: result.outcome });
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/ingestion/application/ingestion.service.test.ts`
Expected: PASS, 8 tests green.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/ingestion/application/ingestion-pipeline.ts src/ingestion/application/ingestion.service.ts src/ingestion/application/ingestion.service.test.ts
git commit -m "feat(ingestion): add IngestionPipeline bundle + IngestionService orchestrator (TDD)"
```

---

## Task 15: IngestionModule + AppModule wire-up

`IngestionModule` bundles application services, the `IngestionPipeline` provider, and repositories. It imports `CatalogModule` and `SefazAlModule` so the orchestrator can resolve its dependencies. Only `IngestionService` is exported — repositories stay internal to the module until a real cross-module consumer appears (M3 search-side, perhaps). This keeps the public surface of the feature minimal.

`AppModule` gains three imports: `EventEmitterModule.forRoot()` (in-memory event bus for domain events), `CatalogModule` (visible boundary even though empty), and `IngestionModule`.

**Files:**

- Create: `src/ingestion/ingestion.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `ingestion.module.ts`**

Write file `src/ingestion/ingestion.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { SefazAlModule } from '../sources/sefaz-al/sefaz-al.module.js';
import { IngestionPipeline } from './application/ingestion-pipeline.js';
import { IngestionService } from './application/ingestion.service.js';
import { NormalizationService } from './application/normalization.service.js';
import { Validator } from './application/validator.service.js';
import { EstablishmentRepository } from './infrastructure/establishment.repository.js';
import { IngestionFailureRepository } from './infrastructure/ingestion-failure.repository.js';
import { PriceObservationRepository } from './infrastructure/price-observation.repository.js';
import { ProductRepository } from './infrastructure/product.repository.js';

@Module({
  imports: [CatalogModule, SefazAlModule],
  providers: [
    Validator,
    NormalizationService,
    IngestionPipeline,
    IngestionService,
    ProductRepository,
    EstablishmentRepository,
    PriceObservationRepository,
    IngestionFailureRepository,
  ],
  exports: [IngestionService],
})
export class IngestionModule {}
```

- [ ] **Step 2: Update `app.module.ts`**

Overwrite `src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CatalogModule } from './catalog/catalog.module.js';
import { IngestionModule } from './ingestion/ingestion.module.js';
import { AppBullMqModule } from './shared/bullmq/bullmq.module.js';
import { AppConfigModule } from './shared/config/config.module.js';
import { DbModule } from './shared/db/db.module.js';
import { HealthModule } from './shared/health/health.module.js';
import { AppLoggingModule } from './shared/logging/logging.module.js';

@Module({
  imports: [
    AppConfigModule,
    AppLoggingModule,
    DbModule,
    AppBullMqModule,
    EventEmitterModule.forRoot({ wildcard: false }),
    HealthModule,
    CatalogModule,
    IngestionModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits with code 0.

- [ ] **Step 4: Boot the API once to verify the module graph compiles**

Make sure docker-compose services are up:

Run: `docker-compose -f docker-compose.dev.yml up -d`

Then in one terminal:

Run: `npm run start:dev:api`
Expected: console reaches `API process listening on port 3000` with no DI resolution errors. Stop with Ctrl-C.

- [ ] **Step 5: Smoke `/health` still works after the new module wire-up**

Boot API again, in another terminal:

Run: `curl -s http://localhost:3000/health | jq '.status'`
Expected: `"ok"`. Stop the API.

- [ ] **Step 6: Run the full local quality sequence**

Run:

```bash
npm run lint && npm run format:check && npm run typecheck && npm run build && npm test
```

Expected: all five exit code 0. Full suite covers the SEFAZ ACL, Validator, NormalizationService, 4 repositories, and IngestionService. Test count after M2.2:

- 3 env schema (M1)
- 1 health controller smoke (M1)
- 6 SEFAZ Zod schemas (Task 1)
- 5 SefazAlClient (Task 3)
- 5 SefazAlAdapter (Task 4)
- 11 Validator (Task 6)
- 3 ProductRepository (Task 9)
- 3 EstablishmentRepository (Task 10)
- 2 IngestionFailureRepository (Task 11)
- 7 PriceObservationRepository (Task 12)
- 7 NormalizationService (Task 13)
- 8 IngestionService (Task 14)

Total: ~61 tests. Coverage thresholds (statements ≥80%, branches ≥75%, functions ≥80%, lines ≥80%) must pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/ingestion/ingestion.module.ts src/app.module.ts
git commit -m "feat(ingestion): wire IngestionModule + EventEmitter into AppModule"
```

- [ ] **Step 8: Push and verify CI**

Run: `git push`

Open the M2.2 branch on GitHub. All 5 CI jobs should turn green.

---

## Wrap-up

M2.2 is done when:

- All 15 tasks committed.
- `npm run lint && npm run format:check && npm run typecheck && npm run build && npm test` all exit 0 locally.
- CI on the M2.2 branch shows all 5 jobs green.
- Test count is ≥61 (the breakdown in Task 15 step 6 is authoritative).

Hand off to **M2.3** — `docs/superpowers/plans/2026-05-11-m2-3-worker-cli-done.md` — which adds the BullMQ processor inside a Worker-only module, the `enqueue` CLI command, the end-to-end test that exercises Queue+Worker via BullMQ Queue events, and the manual done-criterion run against the real SEFAZ AL API.
