---
title: MarketLens — Repo skeleton + first vertical slice (M1 + M2)
status: Draft
date: 2026-05-11
authors: Lucas Almeida
related-adrs: [ADR-0001, ADR-0002, ADR-0003, ADR-0004]
related-context: CONTEXT.md
---

# MarketLens — Repo skeleton + first vertical slice (M1 + M2)

## 1. Overview

This spec covers the foundational work for MarketLens: bootstrapping the repo with a sound, testable, observable skeleton (M1) and shipping the first end-to-end vertical slice that proves the 8-verb ingestion pipeline against the real SEFAZ AL API (M2).

The skeleton is not an empty project — it is sized to support the slice. Tooling, folder layout, and infra decisions are made _with_ the slice in view, not in abstract. The slice is intentionally narrow: a single GTIN, fetched via BullMQ worker on demand, persisted as a SCD Type 2 row in `price_observations`. No HTTP read API, no scheduling cron, no Discovery sweep, no observability dashboards. Those are subsequent slices.

The two milestones ship as **separate PRs** to give each its own review surface and CI gate, but share a single design document because their decisions are coupled.

## 2. Scope

### 2.1 M1 — Skeleton (PR #1)

A repository that:

- boots an empty NestJS app in two process modes (API and Worker), both connected to Postgres + Redis
- runs `lint`, `typecheck`, `test`, `build`, `audit` on every PR via GitHub Actions
- has a `/health` endpoint on the API process (Postgres + Redis liveness)
- has Docker tooling for both production image and local dev (compose)
- enforces code quality gates and coverage thresholds via CI
- contains zero domain logic — only infra plumbing and scaffolding

**Done criterion for M1:**

```
$ docker-compose -f docker-compose.dev.yml up -d        # Postgres + Redis up
$ npm ci
$ npm run db:migrate                                    # zero migrations applied (none yet)
$ npm run start:dev:api &
$ curl http://localhost:3000/health
  { "status": "ok", "details": { "postgres": "up", "redis": "up" } }
$ npm test       # passes (one trivial test per major module)
$ npm run lint && npm run typecheck && npm run build  # all green
$ git push       # CI green: lint, typecheck, test, build, security
```

### 2.2 M2 — First vertical slice (PR #2)

End-to-end ingestion of one GTIN via BullMQ:

- A CLI command (`npm run cli enqueue --gtin=<G> --municipality-ibge-code=<I>`) enqueues a job on the `curated-seed` BullMQ queue
- The Worker process consumes the job, runs the full 8-verb pipeline (`fetch → adapt → validate → normalize → persist`), and emits domain events (`PriceObservationCreated`, `PriceObservationExtended`, `IngestionRejected`)
- Real call to `POST /produto/pesquisa` against SEFAZ AL with the configured `SEFAZ_APP_TOKEN`
- Each `SefazAlPriceItem` from the response goes through the pipeline; SCD Type 2 inserts/extends rows in `price_observations`; HardRejections go to `ingestion_failures`

**Done criterion for M2:**

```
$ docker-compose -f docker-compose.dev.yml up -d
$ npm run db:migrate                                    # 1 migration: initial schema
$ npm run start:dev:worker &
$ npm run cli enqueue --gtin=7894900011517 --municipality-ibge-code=2704302
  → Job enqueued: id=curated-seed_7894900011517_2704302_2026-05-11T14

# ~10s later (SEFAZ latency + persist):
$ psql -c "SELECT count(*) FROM price_observations
           WHERE valid_until = 'infinity'::timestamptz
             AND product_id IN (SELECT id FROM products WHERE gtin = '7894900011517');"
  count: ~50  (one current row per establishment that sells this GTIN in Maceió)

$ psql -c "SELECT count(*) FROM products WHERE gtin = '7894900011517';"
  count: 1     (exactly one canonical Product for the queried GTIN)

$ psql -c "SELECT count(*) FROM establishments;"
  count: ~50

$ npm test          # all pass (unit + integration suite; coverage thresholds met globally per §5.4)
$ npm run lint && npm run typecheck && npm run build
$ git push          # CI green
```

### 2.3 Explicitly out of scope (deferred to later slices)

| Capability                                                    | Deferred to                        | Rationale                                                                               |
| ------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| HTTP search endpoint (`/v1/search`)                           | M3+ (after observability)          | Read-side concerns are independent of ingestion                                         |
| Cron scheduling (`@nestjs/schedule`)                          | M3                                 | M2 proves manual enqueue; cron is a single-decision delta                               |
| Prometheus metrics + `/metrics` endpoint                      | M3 (formalised in ADR-0004 stack)  | Mixing observability into M2 dilutes the slice                                          |
| Discovery queue (`discovery-crawl`, sweeps)                   | M4                                 | Independent ingestion strategy (ADR-0003)                                               |
| Combustível pipeline                                          | M5                                 | Different schema shape, distinct adapter                                                |
| `quality_flag` populated (z-score, NCM mismatch, geo invalid) | M3 (ADR-0008)                      | Requires `OutlierDetector` listener; column exists in schema, populated later           |
| Retry filter for SEFAZ HTTP 500 with "autoriza" body          | M2.x or M3 (ADR-0014)              | M2 default BullMQ retry retries 3× even on auth failures (sub-optimal but not blocking) |
| Postgres FTS columns + indexes for search                     | M3 (ADR-0012)                      | Search not in M2                                                                        |
| PostGIS geometry columns + heatmap                            | when geo heatmap becomes a feature | YAGNI for MVP                                                                           |
| Frontend (any)                                                | separate repo, post-MVP            | API-first                                                                               |

## 3. Architecture

### 3.1 Process topology

Two Node processes, **same `src/`**, **same Docker image**, different entrypoints. In production the same image is deployed twice with different `CMD` overrides; in dev each runs natively under `tsx watch`.

```
                    ┌──────────────────────────────┐
                    │  marketlens (Docker image)   │
                    └──────────────────────────────┘
                            │              │
                  CMD=main-api.js    CMD=main-worker.js
                            │              │
                ┌───────────▼──────┐   ┌───▼─────────────┐
                │  API process     │   │  Worker process │
                │  HTTP + /health  │   │  BullMQ consumer│
                │  CLI commands    │   │  (curated-seed) │
                └───────┬──────────┘   └─────┬───────────┘
                        │                    │
                        └────────┬───────────┘
                                 │
                       ┌─────────▼──────────┐
                       │ Postgres 16        │
                       │ Redis 7 (BullMQ)   │
                       └────────────────────┘
```

**Why split processes:** validated SEFAZ queries can take up to 28.7s (combined-token searches). Running these on the same event loop as the HTTP server would hold response times hostage. Splitting also enables independent scaling (3× API replicas vs 1× Worker, or vice versa) and isolates Worker restarts from API availability.

**Why same `src/` rather than a Nest monorepo:** with only two entrypoints that share every module, the additional structure of `nest-cli.json` monorepo mode (separate `apps/*`, `libs/*`, build orchestration) does not pay for itself yet. Adoption is deferred until a third app appears (e.g., a CLI tool that diverges from the API, or a second service). The migration from this layout to `apps/api/src/`, `apps/worker/src/`, `libs/shared/` is mechanical.

### 3.2 Folder tree

```
marketlens/
├── docs/
│   ├── adr/                                # MADR ADRs (committed history)
│   ├── agents/                             # agent skill configs
│   └── superpowers/specs/                  # design docs (this file)
├── src/
│   ├── ingestion/                          # FEATURE: ingestion pipeline
│   │   ├── application/
│   │   │   ├── ingestion.service.ts        # orchestrator (verb: ingest)
│   │   │   ├── normalization.service.ts    # verb: normalize
│   │   │   └── validator.service.ts        # verb: validate
│   │   ├── domain/
│   │   │   ├── raw-price-observation.ts    # canonical input shape (in-memory)
│   │   │   ├── ingestion-result.ts         # return shape of ingest()
│   │   │   ├── hard-rejection.ts           # reason enum + factory
│   │   │   └── events.ts                   # PriceObservationCreated, …Extended, IngestionRejected
│   │   ├── infrastructure/
│   │   │   ├── curated-seed.processor.ts   # BullMQ processor (wires IngestionService)
│   │   │   ├── curated-seed.processor.e2e.test.ts  # end-to-end: enqueue → consume → persist (testcontainers + MSW)
│   │   │   ├── price-observation.repository.ts  # SCD Type 2 persist
│   │   │   ├── price-observation.repository.test.ts  # integration: real Postgres via testcontainers
│   │   │   ├── product.repository.ts       # find-or-create
│   │   │   ├── establishment.repository.ts # find-or-create
│   │   │   └── ingestion-failure.repository.ts
│   │   ├── ingestion.module.ts
│   │   └── ingestion.module.test.ts        # smoke test
│   ├── catalog/                            # FEATURE: Product / Establishment / Chain entities
│   │   ├── domain/
│   │   │   ├── product.ts                  # entity + invariants
│   │   │   ├── establishment.ts
│   │   │   └── chain.ts
│   │   └── catalog.module.ts
│   ├── sources/                            # ANTI-CORRUPTION LAYER per source
│   │   └── sefaz-al/
│   │       ├── sefaz-al.client.ts          # verb: fetch (axios w/ interceptors)
│   │       ├── sefaz-al.adapter.ts         # verb: adapt (SefazAlPriceItem → RawPriceObservation)
│   │       ├── sefaz-al.schemas.ts         # Zod boundary schemas
│   │       ├── sefaz-al.module.ts
│   │       ├── sefaz-al.client.test.ts
│   │       └── sefaz-al.adapter.test.ts
│   ├── shared/                             # CROSS-CUTTING
│   │   ├── config/
│   │   │   ├── env.schema.ts               # Zod EnvSchema
│   │   │   └── config.module.ts            # @nestjs/config wrapper
│   │   ├── db/
│   │   │   ├── schema/
│   │   │   │   ├── products.ts
│   │   │   │   ├── establishments.ts
│   │   │   │   ├── chains.ts
│   │   │   │   ├── price-observations.ts
│   │   │   │   ├── ingestion-failures.ts
│   │   │   │   └── index.ts                # barrel
│   │   │   ├── client.ts                   # Drizzle client (postgres-js)
│   │   │   └── db.module.ts
│   │   ├── logging/
│   │   │   └── logging.module.ts           # nestjs-pino setup
│   │   ├── health/
│   │   │   └── health.controller.ts        # /health (terminus)
│   │   └── bullmq/
│   │       ├── bullmq.module.ts            # BullMQ root config
│   │       └── queues.ts                   # queue name constants
│   ├── cli/
│   │   ├── main.ts                         # CLI entrypoint (standalone Nest context)
│   │   ├── enqueue.command.ts              # nest-commander: enqueue --gtin --municipality-ibge-code
│   │   └── cli.module.ts
│   ├── app.module.ts                       # root module (imports per-process)
│   ├── main-api.ts                         # API entrypoint
│   └── main-worker.ts                      # Worker entrypoint
├── tests/
│   └── fixtures/
│       └── sefaz-al/
│           ├── produto-pesquisa-coca2l-maceio.json   # captured 2026-05-08
│           ├── produto-pesquisa-empty.json
│           ├── produto-pesquisa-token-invalido.json  # 500 with "autoriza"
│           └── ...
├── drizzle/
│   └── migrations/                         # generated SQL files (committed)
├── scripts/
│   └── migrate.ts                          # standalone migration runner
├── config/
│   └── chains.yaml                         # curated chain mapping (cnpj_root → name)
├── .github/
│   ├── workflows/
│   │   └── ci.yml
│   └── dependabot.yml
├── .husky/
│   ├── pre-commit
│   └── commit-msg
├── docker-compose.dev.yml
├── Dockerfile
├── eslint.config.js
├── prettier.config.js
├── commitlint.config.js
├── vitest.config.ts
├── drizzle.config.ts
├── tsconfig.json
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
├── .nvmrc                                  # `22`
├── .editorconfig
├── README.md
├── CONTEXT.md                              # already exists
└── AGENTS.md                               # already exists
```

### 3.3 Pipeline data flow (M2 — runtime)

```
[CLI] npm run cli enqueue --gtin=… --municipality-ibge-code=…
   │
   ▼
[BullMQ] curated-seed queue (Redis)
   │  jobId = curated-seed_${gtin}_${ibge}_${hour_bucket}    (deterministic)
   │  attempts: 3, backoff: exponential 5s/10s/20s
   ▼
[CuratedSeedProcessor] Worker picks up job
   │
   ▼
[IngestionService.ingest({gtin, municipality_ibge})]
   │
   ├─► (1) [SefazAlClient.fetch(query)]                     verb: fetch
   │       → axios POST /produto/pesquisa with AppToken
   │       → SefazAlPriceResponse (Zod-validated at boundary)
   │
   ├─► for each item in response.conteudo:
   │     │
   │     ├─► (2) [SefazAlAdapter.adapt(item)]                verb: adapt
   │     │       → RawPriceObservation (canonical, in-memory)
   │     │
   │     ├─► (3) [Validator.validate(raw)]                   verb: validate
   │     │       → Result<RawPriceObservation, HardRejection>
   │     │       │
   │     │       ├─ Err(rejection): record in ingestion_failures
   │     │       │                  emit IngestionRejected
   │     │       │                  continue to next item
   │     │       │
   │     │       └─ Ok(raw):
   │     │
   │     ├─► (4) [NormalizationService.normalize(raw, jobContext)]  verb: normalize
   │     │       → { product, observationData } | { skipped: true, reason: 'cross_pollution' }
   │     │       Steps:
   │     │         a. CuratedSeed cross-pollution defense: if jobContext is a CuratedSeed
   │     │            job (queriedGtin known) and raw.gtin !== queriedGtin, return
   │     │            { skipped: true, reason: 'cross_pollution' } — SEFAZ's token-search
   │     │            can return items with adjacent GTINs. The orchestrator increments
   │     │            IngestionResult.skipped and continues to the next item; no domain
   │     │            event is emitted (skips are an internal pipeline concern, not a
   │     │            domain fact about prices). Discovery jobs pass jobContext =
   │     │            { kind: 'discovery' } and DO NOT apply this filter.
   │     │         b. find-or-create Product by GTIN (or fallback_hash if GTIN null)
   │     │         c. canonical_description selection (prefer source_canonical_description from
   │     │            SEFAZ descricaoSefaz when present; else normalized item.descricao)
   │     │         d. find-or-create Establishment by CNPJ
   │     │         e. round sale_value and declared_value to 4 decimal places (numeric scale)
   │     │
   │     │       The orchestrator (IngestionService) checks the discriminator: on
   │     │       skipped, accumulate the counter and continue; otherwise pass
   │     │       { product, observationData } to step (5).
   │     │
   │     └─► (5) [Repository.persist(product, observationData)]  verb: persist
   │             → PriceObservation
   │             SCD Type 2 logic (equality predicate explicit):
   │               "Same value" iff (declared_value, sale_value, sold_at) match exactly.
   │               `fetched_at` is NOT part of the predicate — it is our wall-clock,
   │               not source state.
   │
   │               Lookup: SELECT * FROM price_observations
   │                       WHERE product_id = ? AND establishment_id = ?
   │                         AND valid_until = 'infinity'::timestamptz
   │
   │               - Case A (no current row exists): INSERT new row with
   │                 fetched_at=now(), last_seen_at=now(), valid_until='infinity'.
   │                  emit PriceObservationCreated { kind: 'first_observation' }
   │
   │               - Case B (current row matches on (declared_value, sale_value, sold_at)):
   │                 UPDATE that row SET last_seen_at = now()  (single-column write).
   │                 No new row. fetched_at preserved (first time we saw this tuple).
   │                  emit PriceObservationExtended
   │
   │               - Case C (current row does not match): UPDATE old row SET
   │                 valid_until = now() (closes the historical row),
   │                 then INSERT new row with fetched_at=now(), last_seen_at=now(),
   │                 valid_until='infinity'.
   │                  emit PriceObservationCreated { kind: 'price_change' }
   │
   │               Each item in response.conteudo is processed in its own Postgres
   │               transaction (per-item boundary). The SELECT ... FOR UPDATE on
   │               (product_id, establishment_id) WHERE valid_until = 'infinity'
   │               prevents races across concurrent workers. A failure on one item
   │               does NOT abort the rest of the response.
   │
   └─► return IngestionResult { fetched, persisted, extended, rejected, skipped }
       where `fetched`   = total items in response.conteudo
             `persisted` = count of Case A + Case C outcomes (new rows inserted)
             `extended`  = count of Case B outcomes (last_seen_at updated)
             `rejected`  = count of Validator HardRejections
             `skipped`   = count of cross-pollution skips (CuratedSeed only)
       Invariant: fetched = persisted + extended + rejected + skipped

[Domain events] flow through EventEmitterModule (in-memory)
   → listeners (logging, future metrics) — M2 has only logging listener
```

### 3.4 Domain event payloads

Refinement of the four events from CONTEXT.md, with explicit payload shapes for M2 listeners:

| Event                      | Payload                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `PriceObservationCreated`  | `{ observation_id, product_id, establishment_id, source_id, kind: 'first_observation' \| 'price_change' }` |
| `PriceObservationExtended` | `{ observation_id, product_id, establishment_id, source_id }`                                              |
| `IngestionRejected`        | `{ source_id, reason, raw_payload }`                                                                       |
| `QualityFlagged`           | _not emitted in M2_ — column exists; populated in M3 (ADR-0008)                                            |

The `kind` discriminator on `PriceObservationCreated` is essential for downstream observability: a counter that does not distinguish "first observation of a (product, establishment) pair" from "price change on an existing pair" cannot answer the question "how often do prices actually change?" — which is the whole point of the project. ADR-0004's planned metric `marketlens_price_observations_created_total` MUST be labelled `kind` accordingly. CONTEXT.md's event table will be amended in the same PR to add a payload column.

When M3 introduces metric instrumentation, the counter names follow ADR-0004's naming convention:

- `marketlens_price_observations_created_total{kind="first_observation"|"price_change", source_id}`
- `marketlens_price_observations_extended_total{source_id}`
- `marketlens_ingestion_rejections_total{reason, source_id}`

The events are emitted in M2 (the column-level state changes), but the metric handlers are not wired until M3. The contract above is the source of truth — wiring later is a single listener class per event.

### 3.5 CONTEXT.md amendments in this PR

This spec's implementation introduces two refinements that need to be reflected in `CONTEXT.md` for the canonical domain language to stay accurate. These edits land in the same PR as M1 (skeleton) so the codebase and the glossary ship together:

1. **PriceObservation column semantics.** The natural key remains `(product_id, establishment_id, fetched_at)` and SCD Type 2 versioning is still expressed via `valid_until`. The new wording must clarify that `fetched_at` is "the first time we observed this tuple of `(declared_value, sale_value, sold_at)`" (immutable per row), and introduce `last_seen_at` as "the most recent time we re-confirmed the tuple" (mutable on Case B). The historical interpretation of `fetched_at` as the time of any fetch is incorrect under the SCD2 contract defined in §3.3.
2. **Domain event payloads.** The events table gains a "Payload" column matching §3.4 above, including the `kind` discriminator on `PriceObservationCreated`.

## 4. Database schema (Drizzle)

All tables created via a single initial migration generated by `drizzle-kit generate`. Migrations are SQL files committed to `drizzle/migrations/`, applied by the standalone runner `scripts/migrate.ts`.

### 4.1 `products`

```typescript
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gtin: text('gtin'), // nullable
    fallback_hash: text('fallback_hash'), // nullable
    canonical_description: text('canonical_description').notNull(),
    fiscal_code: text('fiscal_code').notNull(), // NCM 8 digits
    category_gpc_code: text('category_gpc_code').notNull(), // GPC 8 digits
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('products_gtin_unique_idx')
      .on(t.gtin)
      .where(sql`gtin IS NOT NULL`),
    uniqueIndex('products_fallback_hash_unique_idx')
      .on(t.fallback_hash)
      .where(sql`fallback_hash IS NOT NULL`),
    check(
      'products_exactly_one_id',
      sql`(gtin IS NOT NULL)::int + (fallback_hash IS NOT NULL)::int = 1`,
    ),
  ],
);
```

### 4.2 `establishments`

```typescript
export const establishments = pgTable(
  'establishments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cnpj: text('cnpj').notNull().unique(), // 14 digits
    cnpj_root: text('cnpj_root')
      .notNull()
      .generatedAlwaysAs((): SQL => sql`substr(${establishments.cnpj}, 1, 8)`),
    legal_name: text('legal_name').notNull(),
    trade_name: text('trade_name'),
    street: text('street'),
    street_number: text('street_number'),
    neighborhood: text('neighborhood').notNull(),
    postal_code: text('postal_code'),
    municipality_ibge_code: text('municipality_ibge_code').notNull(), // 7 digits
    municipality_name: text('municipality_name').notNull(),
    latitude: doublePrecision('latitude'), // nullable; raw value M2
    longitude: doublePrecision('longitude'),
    chain_id: uuid('chain_id').references(() => chains.id), // nullable
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('establishments_cnpj_root_idx').on(t.cnpj_root),
    index('establishments_municipality_idx').on(t.municipality_ibge_code),
  ],
);
```

### 4.3 `chains`

```typescript
export const chains = pgTable('chains', {
  id: uuid('id').primaryKey().defaultRandom(),
  cnpj_root: text('cnpj_root').notNull().unique(),
  name: text('name').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`config/chains.yaml` may be empty in M2; M3+ populates the curated 20 retailers.

### 4.4 `price_observations` (SCD Type 2)

```typescript
export const priceObservations = pgTable(
  'price_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id),
    establishment_id: uuid('establishment_id')
      .notNull()
      .references(() => establishments.id),
    fetched_at: timestamp('fetched_at', { withTimezone: true }).notNull(), // first time WE saw this (declared_value, sale_value, sold_at) tuple
    last_seen_at: timestamp('last_seen_at', { withTimezone: true }).notNull(), // most recent fetch where the tuple was re-confirmed; updated on Extended
    sold_at: timestamp('sold_at', { withTimezone: true }).notNull(), // SEFAZ dataVenda (immutable per row)
    declared_value: numeric('declared_value', { precision: 12, scale: 4 }).notNull(),
    sale_value: numeric('sale_value', { precision: 12, scale: 4 }).notNull(),
    valid_until: timestamp('valid_until', { withTimezone: true })
      .notNull()
      .default(sql`'infinity'::timestamptz`), // 'infinity' = current row
    source_id: text('source_id').notNull(), // 'sefaz-al' initially
    quality_flag: text('quality_flag'), // null in M2; column exists for M3
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('price_observations_current_row_idx')
      .on(t.product_id, t.establishment_id)
      .where(sql`valid_until = 'infinity'::timestamptz`),
    index('price_observations_product_time_idx').on(t.product_id, t.fetched_at.desc()),
    index('price_observations_establishment_time_idx').on(t.establishment_id, t.fetched_at.desc()),
    check(
      'price_observations_quality_flag_valid',
      sql`quality_flag IS NULL OR quality_flag IN ('price_anomaly', 'ncm_mismatch', 'geo_invalid')`,
    ),
    check('price_observations_last_seen_after_fetched', sql`last_seen_at >= fetched_at`),
  ],
);
```

### 4.5 `ingestion_failures`

```typescript
export const ingestionFailures = pgTable(
  'ingestion_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source_id: text('source_id').notNull(),
    reason: text('reason').notNull(), // 'gtin_invalid_length' | ...
    raw_payload: jsonb('raw_payload').notNull(), // RawPriceObservation
    occurred_at: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ingestion_failures_reason_idx').on(t.reason),
    index('ingestion_failures_occurred_at_idx').on(t.occurred_at.desc()),
  ],
);
```

### 4.6 Schema design rationale

| Decision                                                                                      | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uuid` via `gen_random_uuid()` (v4)                                                           | Postgres 13+ built-in; UUID v7 still requires extension in PG16; bigserial vulnerable to enumeration                                                                                                                                                                                                                                                                                                                            |
| `numeric(12, 4)` for money                                                                    | Postgres docs explicitly warn against `money` (locale-dep) and `double precision` (precision loss); 4 decimals preserves SEFAZ vendor floats after rounding                                                                                                                                                                                                                                                                     |
| SCD Type 2 with `'infinity'::timestamptz` for current row                                     | Kimball pattern; cleaner than NULL or magic `9999-12-31`                                                                                                                                                                                                                                                                                                                                                                        |
| Generated `cnpj_root` (PG always STORED)                                                      | PostgreSQL only supports `STORED` generated columns (no `VIRTUAL` mode); Drizzle's `generatedAlwaysAs` emits `STORED` by default in `pg-core`; callback style `(): SQL => sql\`...\`` is recommended to keep references type-safe                                                                                                                                                                                               |
| Partial **UNIQUE** index `WHERE valid_until = 'infinity'` on `(product_id, establishment_id)` | Doubles as performance (99% of queries want current row) AND race protection: `SELECT … FOR UPDATE` in §3.3 locks an existing current row, but does not protect against two concurrent transactions both inserting a NEW current row for the same `(product_id, establishment_id)`. The unique partial index makes the second INSERT fail at the DB level, forcing a retry that will now find the current row and take the lock |
| `quality_flag` CHECK constraint                                                               | Bounded enum at the DB level enforces CONTEXT.md vocabulary even if M3 listener has a bug. Adding a new flag requires a migration — intentional friction that prevents silent free-text values                                                                                                                                                                                                                                  |
| FK `chain_id` nullable                                                                        | Mom-and-pop establishments without curated chain are legitimate                                                                                                                                                                                                                                                                                                                                                                 |
| CHECK constraint enforcing exactly one of `(gtin, fallback_hash)`                             | Domain invariant from CONTEXT.md; preserved at DB level                                                                                                                                                                                                                                                                                                                                                                         |
| `fiscal_code` and `category_gpc_code` NOT NULL                                                | SEFAZ returns these for every standard `/produto/pesquisa` item; `NormalizationService` resolves them before persist (fills GPC from prefix table if SEFAZ omits, falls back to `'unknown_ncm'`/`'unknown_gpc'` sentinel only as last resort, recorded with a `quality_flag` candidate to be defined in ADR-0008)                                                                                                               |

## 5. Stack & tooling

### 5.1 Runtime

| Layer       | Choice                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node        | **22 LTS**                    | Active until April 2027; pin major in `.nvmrc` and `engines.node`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| TypeScript  | **5.6 LTS**                   | `strict`, `noUncheckedIndexedAccess`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2023`, `experimentalDecorators`, `emitDecoratorMetadata`, `isolatedModules`. **Caveat:** NodeNext + NestJS 11 + `experimentalDecorators` works but is fiddly — emit ESM only after running `npm run build && node dist/main-api.js` once locally to verify; if module-resolution issues appear, the fallback is `module: CommonJS, moduleResolution: Node10` which the NestJS sample apps still use by default |
| Framework   | **NestJS 11**                 | `@nestjs/core`, `@nestjs/common`, `@nestjs/config`, `@nestjs/axios`, `@nestjs/bullmq`, `@nestjs/event-emitter`, `@nestjs/terminus`                                                                                                                                                                                                                                                                                                                                                                                |
| ORM         | **Drizzle**                   | `drizzle-orm`, `drizzle-kit`, `postgres-js` driver                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Queue       | **BullMQ 5**                  | `bullmq`, `@nestjs/bullmq`, `@bull-board/express` + `@bull-board/api`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| HTTP client | **axios** via `@nestjs/axios` | Interceptor support for retry filter (M2.x), timeouts, cancellation                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Logger      | **pino** via `nestjs-pino`    | Structured JSON, requestId via `pino-http`; Loki-friendly (ADR-0004)                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Validation  | **Zod 3**                     | Boundary types (SEFAZ payloads), env schema, single validation lib across stack                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CLI         | **nest-commander**            | `enqueue` command in M2; M3+ adds `seed-chains`, `backfill`, `manual-ingest`, etc. Chosen over a thin `commander` wrapper because subsequent commands will need NestJS DI (services, repositories, ConfigModule) and refactoring from plain `commander` to `nest-commander` later is more disruptive than starting on the right tool                                                                                                                                                                              |

### 5.2 Test framework

| Layer                              | Choice                     | Notes                                                                                                                     |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Test runner                        | **Vitest 2**               | Vite-powered, Jest-compatible API, ~3× faster than Jest, ESM-first                                                        |
| Test colocation                    | `*.test.ts` next to source | Modern Vitest convention; reduces directory traversal                                                                     |
| Module mocking                     | `vi.mock`                  | NestJS `Test.createTestingModule().overrideProvider(...)` works identically                                               |
| HTTP mocking (integration)         | **MSW 2**                  | Mock Service Worker; intercepts at network layer; fixtures in `tests/fixtures/sefaz-al/`                                  |
| Container management (integration) | **Testcontainers**         | `@testcontainers/postgresql`, `@testcontainers/redis`; ephemeral containers per test job; identical local + CI experience |

### 5.3 Quality gates (ESLint + sonarjs)

Configured in `eslint.config.js` (flat config, ESLint 9):

| Rule                           | Limit   | Source                                                                                                    |
| ------------------------------ | ------- | --------------------------------------------------------------------------------------------------------- |
| `complexity` (cyclomatic)      | **10**  | McCabe (1976) original; SonarQube default; Watson & McCabe NIST SP 500-235 — defect rate triples above 10 |
| `sonarjs/cognitive-complexity` | **15**  | Campbell (2018) SonarSource whitepaper; SonarQube default                                                 |
| `max-lines-per-function`       | **50**  | ESLint default; Robert Martin "rarely 20, almost never 100"                                               |
| `max-lines`                    | **300** | Robert Martin "few hundred lines"; SonarQube default 1000 considered too lax for AI-generated code        |
| `max-depth`                    | **3**   | Linus Torvalds Linux Kernel norm                                                                          |
| `max-params`                   | **4**   | Robert Martin "more than 3 questionable" + 1 margin for TS DTOs                                           |

**Excludes** (gates relaxed):

- `**/schemas/**` — Drizzle schema files legitimately exceed `max-lines`
- `**/migrations/**` — generated SQL
- `**/*.test.ts` — test files have higher complexity tolerance for arrange/act/assert

**Type-aware linting enabled** via `typescript-eslint`:

- `no-floating-promises` (catches missing `await` on Promises — critical for async-heavy code)
- `no-misused-promises`
- `no-unsafe-return`, `no-unsafe-assignment` (limited use; can be downgraded to warn if too noisy)

**Why these numbers (AI-generation context):** code in this repo is generated and edited primarily by AI assistants. AI tends to produce long functions, deep nesting, and many parameters without spontaneous extraction. These thresholds — aligned with industry standards published by McCabe (1976), SonarSource (Campbell 2018), Robert Martin (Clean Code 2008), and Linux Kernel coding style — act as guardrails that force the AI to extract named helpers. The thresholds will be revisited after the first 5,000 lines of real codebase land and we can observe whether real complexity exceeds them in legitimate code paths.

### 5.4 Coverage thresholds (Vitest)

```typescript
// vitest.config.ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html'],
  thresholds: {
    statements: 80,
    branches: 75,
    functions: 80,
    lines: 80,
  },
  exclude: [
    '**/*.module.ts',          // NestJS module boilerplate (binding-only)
    '**/main-*.ts',            // entrypoints (covered by e2e)
    '**/*.config.ts',
    '**/schemas/**',           // Drizzle schema (no logic)
    '**/migrations/**',        // generated
    '**/types/**',             // type-only
    '**/index.ts',             // barrel exports
    'scripts/**',
    'src/**/*.test.ts',
  ],
}
```

Industry-aligned (SonarQube default 80%, Google Testing Blog "good" 60-80%, NIST SP 500-235 80-90% for critical systems). Excludes prevent Goodhart's-Law gaming on Nest boilerplate.

### 5.5 Lint + format

- **ESLint 9 flat** — `eslint.config.js`
- **Prettier 3** — `prettier.config.js` (`singleQuote: true`, `trailingComma: 'all'`, `printWidth: 100`, `arrowParens: 'always'`)
- **`eslint-config-prettier`** disables ESLint rules that conflict with Prettier
- Prettier is **not** wrapped in ESLint (`eslint-plugin-prettier` is a known antipattern); they run as separate npm scripts

### 5.6 Pre-commit hooks (Husky + lint-staged + commitlint)

```javascript
// package.json (excerpt)
"lint-staged": {
  "*.{ts,js}":           ["prettier --write", "eslint --fix"],
  "*.{json,yml,yaml,md}": ["prettier --write"]
}
```

```bash
# .husky/pre-commit
npx lint-staged
```

```bash
# .husky/commit-msg
npx --no -- commitlint --edit ${1}
```

```javascript
// commitlint.config.js
module.exports = { extends: ['@commitlint/config-conventional'] };
```

**Behavior:**

- Pre-commit auto-fixes formatting and lint trivia on staged files; only blocks on non-fixable ESLint errors
- `commit-msg` validates Conventional Commits format (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`, `ci:`, `build:`, `style:`)
- `git commit --no-verify` available for emergencies; not the norm
- **Typecheck and test do not run pre-commit** — too slow (~30-40s); CI is the authoritative gate (per project convention: CI is the gatekeeper, not local pre-commit)

## 6. Operations

### 6.1 Dockerfile

```dockerfile
# Stage 1: build
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Stage 2: runtime
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY drizzle ./drizzle
COPY config ./config
ENTRYPOINT ["node"]
CMD ["dist/main-api.js"]
```

The same image runs both processes; orchestration overrides `CMD` per service:

- API service: `CMD ["dist/main-api.js"]`
- Worker service: `CMD ["dist/main-worker.js"]`

Multi-stage trims ~80% of final size by excluding dev dependencies, TS source, and npm cache.

### 6.2 `docker-compose.dev.yml`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: marketlens
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: marketlens_dev
    ports: ['5432:5432']
    volumes: ['postgres_data:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U marketlens']
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    volumes: ['redis_data:/data']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

The application itself is **not** in this compose file. It runs natively on the host via `tsx watch` for hot-reload during dev.

### 6.3 npm scripts

```jsonc
{
  "scripts": {
    "build": "tsc -b",
    "start:dev:api": "tsx watch src/main-api.ts",
    "start:dev:worker": "tsx watch src/main-worker.ts",
    "start:api": "node dist/main-api.js",
    "start:worker": "node dist/main-worker.js",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx scripts/migrate.ts",
    "db:studio": "drizzle-kit studio",
    "db:seed-chains": "tsx scripts/seed-chains.ts", // M3+
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "cli": "tsx src/cli/main.ts",
    "prepare": "husky",
  },
}
```

### 6.4 Migrations

- `npm run db:generate` — Drizzle Kit inspects `src/shared/db/schema/index.ts` and emits SQL files into `drizzle/migrations/`
- SQL files are committed to git, reviewed in PR
- `npm run db:migrate` — runs `scripts/migrate.ts`, a 30-line standalone script that calls `drizzle-orm/migrator.migrate()` against the `DATABASE_URL` from env
- **Never auto-run on application boot** — race conditions across replicas, hard to roll back, hides errors. Migrations are an explicit step in CI/CD pipelines and dev workflow.

## 7. CI / Branch protection / Dependabot

### 7.1 GitHub Actions workflow (`.github/workflows/ci.yml`)

Five jobs run in parallel: `lint`, `typecheck`, `test`, `build`, `security`. There is no shared `setup` job — each job is self-contained and relies on the `actions/setup-node@v4` npm cache for fast dependency restoration.

```yaml
name: CI
on:
  pull_request:
  push: { branches: [main] }
  workflow_dispatch:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck

  test:
    runs-on: ubuntu-latest
    env:
      SEFAZ_APP_TOKEN: dummy-for-ci
      SEFAZ_API_BASE_URL: http://api.sefaz.al.gov.br/sfz-economiza-alagoas-api/api/public
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run test:coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run build

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm audit --audit-level=critical
      - run: npm audit --audit-level=high || true # informational, does not block
```

**Notes on the workflow shape:**

- No shared `setup` job. Each job runs `npm ci` independently, relying on `actions/setup-node@v4`'s `cache: 'npm'` to deduplicate the install across jobs (the cache key is the lockfile hash; install is near-instant on cache hit). A shared setup that uploaded `node_modules` as an artifact would be slower than letting each job restore from the npm cache.
- Tests use Testcontainers; no GitHub Actions `services:` block needed. Postgres + Redis containers are spawned per integration test by `@testcontainers/*`. Docker is already available on `ubuntu-latest` runners.
- `npm audit --audit-level=critical` is the merge gate; the `--audit-level=high` line runs as an informational report (will not fail the workflow). This avoids the well-known npm audit noise problem (transitive dev-dep CVEs without a fix) while still surfacing issues that need attention.

### 7.2 Branch protection on `main` (configured via GitHub UI)

- Require status checks before merging: `lint`, `typecheck`, `test`, `build`, `security`
- Require branches to be up to date before merging
- Require linear history (rebase or squash, no merge commits)
- Disallow force pushes
- Pull request review: optional (solo project)

### 7.3 Dependabot (`.github/dependabot.yml`)

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly }
    open-pull-requests-limit: 5
    labels: [dependencies]
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
```

## 8. HardRejection rules (M2)

Three minimal rules. Each rule's outcome is recorded in `ingestion_failures` with the structured `reason` value.

| Rule                     | `reason` value             | Logic                                           |
| ------------------------ | -------------------------- | ----------------------------------------------- | --- | ----------------------- |
| GTIN invalid length      | `gtin_invalid_length`      | After stripping leading zeros, `gtin.length < 8 |     | gtin.length > 14`       |
| GTIN invalid check digit | `gtin_invalid_check_digit` | GS1 Mod-10 check digit does not validate        |
| Sale value out of range  | `sale_value_out_of_range`  | `sale_value < 0.01                              |     | sale_value > 1_000_000` |

**Excluded from M2:**

- Geo invalid (lat=0 AND lng=0) — persists in M2; `quality_flag = 'geo_invalid'` populated by M3 OutlierDetector
- Statistical anomalies (z-score, NCM mismatch) — require historical context; M3 work
- Duplicate sold_at, CNPJ format, descricao length — additive, can join in M2.x or M3 without data loss

**Rationale:** persist-and-flag is the dominant industry pattern for partially-valid data (Netflix Hawk, dbt warn-severity). Hard-rejecting an observation because of one suspect field discards otherwise useful price data.

## 9. BullMQ config (curated-seed queue)

### 9.1 Module configuration (shared between processes)

```typescript
// src/shared/bullmq/bullmq.module.ts (excerpt)
BullModule.forRoot({
  connection: { url: env.REDIS_URL },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },                // 5s, 10s, 20s
    removeOnComplete: { count: 1000 },
    removeOnFail: { age: 7 * 24 * 60 * 60 },                      // keep failures 7 days, bounded by time not count
  },
}),
BullModule.registerQueue({
  name: 'curated-seed',
  settings: {
    lockDuration: 60_000,                                          // safety net against worker crash mid-job;
                                                                   // BullMQ auto-renews the lock while the processor runs,
                                                                   // so this is NOT a timeout for SEFAZ latency (the axios timeout is)
    maxStalledCount: 1,
  },
}),
```

**Note on `removeOnFail`:** time-bounded retention (7 days) is preferred over count-bounded because per-call failures multiply (one bad GTIN can produce 50 per-establishment failures per hour cycle). With ~300 CuratedSeed SKUs at 1h cadence, a count of 5,000 would fill in under a day. The authoritative failure log is `ingestion_failures` in Postgres; Redis retention is only for Bull Board introspection.

### 9.2 Processor (Worker process only)

```typescript
// src/ingestion/infrastructure/curated-seed.processor.ts (excerpt)
@Processor('curated-seed', { concurrency: 2 }) // intentionally low for M2; see §9.4
export class CuratedSeedProcessor {
  async process(job: Job<{ gtin: string; municipalityIbgeCode: string }>) {
    return this.ingestionService.ingest(job.data);
  }
}
```

### 9.3 API process vs Worker process — module imports

Both processes share the same `BullModule.forRoot(...)` and `BullModule.registerQueue({ name: 'curated-seed' })`, but only the Worker process registers the `@Processor` class.

| Process | `BullModule.forRoot` | `registerQueue('curated-seed')` | `@Processor('curated-seed')`      | Bull Board mounted    |
| ------- | -------------------- | ------------------------------- | --------------------------------- | --------------------- |
| API     | ✅                   | ✅                              | ❌ — does **not** consume jobs    | ✅ at `/admin/queues` |
| Worker  | ✅                   | ✅                              | ✅ — only place jobs are consumed | ❌                    |

Bull Board is mounted on the API process so the queue UI lives at the HTTP surface; it introspects Redis directly without needing a worker. Auth: none in `NODE_ENV=development`, basic auth via `BULL_BOARD_USER` / `BULL_BOARD_PASS` in production.

### 9.4 Concurrency rationale

`concurrency: 2` (per worker instance) for M2. Rationale:

- SEFAZ AL Manual v1.0 explicitly requests that consumers avoid overloading the API (ADR-0002, ref. §4 of the SEFAZ manual)
- M2's done criterion polls a single GTIN; parallelism above 2 has no observable benefit
- When M3's cron lands with ~300 CuratedSeed jobs per hour, the question of optimal concurrency becomes empirical — to be recalibrated using the `sefaz_observation_age_seconds` histogram (ADR-0004 M4 metric) and CI/dashboard signals, not by guessing
- A change to concurrency is a single-line edit; deferring the tuning costs nothing and avoids picking a wrong number based on no data

### 9.5 Job ID strategy (deterministic, idempotent)

```typescript
const hourBucket = new Date().toISOString().slice(0, 13); // '2026-05-11T14'
const jobId = `curated-seed_${gtin}_${municipalityIbgeCode}_${hourBucket}`;
queue.add('ingest', { gtin, municipalityIbgeCode }, { jobId });
```

Re-enqueueing the same `(gtin, municipality, hour)` is a no-op — protects against double-fire from cron bugs (when M3 cron lands) and from a developer accidentally hammering the CLI.

The separator is `_`, not `:`. BullMQ uses `:` internally to namespace its Redis keys (`bull:curated-seed:<jobId>`); a `:` inside the jobId itself would blur that boundary and make keys harder to read and grep. Keep the underscore.

### 9.6 Graceful shutdown

`OnApplicationShutdown` lifecycle hook calls `worker.close()` on SIGTERM. BullMQ drains in-flight jobs (waits for the current `process()` to complete or hit timeout) before exiting. Without this, a deploy that restarts the Worker mid-job moves the job to "failed" and triggers the retry chain unnecessarily.

## 10. AppToken & secrets

- `SEFAZ_APP_TOKEN` is **required** by the env Zod schema. App fails fast at boot if missing.
- `.env` is gitignored; `.env.example` is committed with placeholders.
- CI sets `SEFAZ_APP_TOKEN=dummy-for-ci`. Tests do not hit SEFAZ; MSW intercepts HTTP.
- README documents how to obtain a real token (email to `api@sefaz.al.gov.br` per SEFAZ AL Manual v1.0).

```dotenv
# .env.example
DATABASE_URL=postgres://marketlens:dev@localhost:5432/marketlens_dev
REDIS_URL=redis://localhost:6379
SEFAZ_APP_TOKEN=<request via email to api@sefaz.al.gov.br>
SEFAZ_API_BASE_URL=http://api.sefaz.al.gov.br/sfz-economiza-alagoas-api/api/public
SEFAZ_HTTP_TIMEOUT_MS=35000
LOG_LEVEL=info
NODE_ENV=development
PORT=3000
```

## 11. Tests strategy

### 11.0 Pipeline verb coverage in M2

M2 exercises **6 of the 8 pipeline verbs** defined in CONTEXT.md: `fetch`, `adapt`, `validate`, `normalize`, `persist`, and `ingest` (the orchestrator). Deferred to later slices: `flag` (M3 — `OutlierDetector` listener) and `search` (M3+ — read-side service).

### 11.1 Test types in M2

| Type        | Scope                                                                                         | Tools                                 | Where                                       |
| ----------- | --------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| Unit        | Pure logic (Validator, Adapter, hash functions)                                               | Vitest                                | colocated `*.test.ts`                       |
| Integration | Repository persist (real Postgres via Testcontainers)                                         | Vitest + `@testcontainers/postgresql` | colocated                                   |
| Integration | SefazAlClient (axios + interceptors)                                                          | Vitest + MSW                          | colocated                                   |
| End-to-end  | Worker enqueue → process → persist (real Postgres + Redis via Testcontainers + MSW for SEFAZ) | Vitest + Testcontainers + MSW         | `*.e2e.test.ts` colocated next to processor |

### 11.2 Fixtures

Captured from real SEFAZ calls during the 2026-05-08 validation, committed to `tests/fixtures/sefaz-al/`:

- `produto-pesquisa-coca2l-maceio.json` — happy path, ~50 items
- `produto-pesquisa-empty.json` — `totalRegistros: 0`
- `produto-pesquisa-token-invalido.json` — HTTP 500 with Spring Boot body containing "autoriza"
- `produto-pesquisa-gtin-invalido.json` — HTTP 400
- `produto-pesquisa-codigoIBGE-string.json` — HTTP 400 type error
- `produto-pesquisa-with-descricaoSefaz.json` — happy path with `descricaoSefaz` field present
- `produto-pesquisa-without-descricaoSefaz.json` — happy path missing `descricaoSefaz`
- `produto-pesquisa-geo-zero.json` — establishment with `latitude: 0, longitude: 0`

### 11.3 No real SEFAZ calls in CI

Hitting the real SEFAZ API in CI is forbidden. MSW handlers serve fixtures. A separate, opt-in command (`npm run test:e2e:sefaz-real`) exists for manual local sanity checks against the real API, but it is **never** run in CI and requires a real token.

## 12. Deferred / out of M2 scope

Recap (also in §2.3):

| Capability                          | Slice                              |
| ----------------------------------- | ---------------------------------- |
| HTTP `/v1/search` endpoint          | M3+ (search ADR-0006/0012)         |
| Cron scheduling                     | M3                                 |
| Prometheus metrics + `/metrics`     | M3 (ADR-0004 stack)                |
| Discovery queue                     | M4 (ADR-0003)                      |
| Combustível pipeline                | M5                                 |
| `quality_flag` populated            | M3 (ADR-0008)                      |
| Retry filter for 500 "autoriza"     | M2.x or M3 (ADR-0014)              |
| Postgres FTS columns/indexes        | M3 (ADR-0012)                      |
| PostGIS                             | when geo features land             |
| Frontend                            | post-MVP                           |
| Bull Board basic auth in production | first deploy                       |
| Grafana dashboards JSON commit      | M3 (ADR-0004 implementation slice) |

## 13. Open questions

None blocking M1+M2 implementation. Recurring future questions tracked separately:

- ADR-0008 formalisation of HardRejection vs QualityFlag boundary
- ADR-0014 retry policy (filter for "autoriza" 500)
- Promotion criteria for Discovery → CuratedSeed (ADR-deferred per ADR-0003)
- Stale SKU lifecycle (`last_observed_at`, "ghost" handling)

## 14. Risks

| Risk                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEFAZ AppToken revoked or rate-limited mid-development                | Fixtures cover all known shapes; MSW makes development independent of API availability                                                                                                                                                                                                                                                                                                                                                                                                                       |
| BullMQ stalled job under unforeseen long SEFAZ latency                | BullMQ auto-renews the job lock while the processor is running; `lockDuration: 60s` is the crash-recovery floor (worker dies → another picks up the job 60s later). SEFAZ latency is bounded by `SEFAZ_HTTP_TIMEOUT_MS` (35s), not by lock. Recalibrate `lockDuration` only if observed crash-recovery time becomes a real problem.                                                                                                                                                                          |
| Drizzle migration generated incorrectly                               | All migrations reviewed in PR; `db:migrate` is explicit, not boot-time                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ESLint Tier S thresholds too strict for legitimate orchestration code | Excludes for `schemas/` and `migrations/`; can downgrade specific rules to warn if justified                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Coverage Tier 2 forces gaming on Nest boilerplate                     | Wide excludes (`*.module.ts`, `main-*.ts`, configs, schemas)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Single Drizzle migration becoming difficult to review                 | If schema becomes large, split into multiple `npm run db:generate` runs creating separate migration files                                                                                                                                                                                                                                                                                                                                                                                                    |
| Fixture drift from live SEFAZ AL schema                               | Fixtures were captured on 2026-05-08. If SEFAZ adds, removes, or renames a field, MSW tests will pass while production fails silently. Mitigation: (a) Zod boundary schemas fail-closed on unknown required fields and `.strict()` is opt-in for the canonical shape so additions are observable but non-fatal; (b) quarterly fixture refresh ritual; (c) opt-in `npm run test:e2e:sefaz-real` against live SEFAZ from a developer workstation with a real token, gated by a CI label not enabled by default |
| SCD Type 2 row growth if equality predicate is wrong                  | The persist contract in §3.3 is authoritative: equality is on `(declared_value, sale_value, sold_at)`. A repository-level unit test asserts that re-persisting an identical observation updates `last_seen_at` without inserting a new row; this test is part of M2's done criterion                                                                                                                                                                                                                         |

## 15. References

### 15.1 Project documents

- `CONTEXT.md` — domain language, 8-verb pipeline, 4 events, naming policy
- `docs/adr/0001-multi-source-anti-corruption-layer.md`
- `docs/adr/0002-fixed-cron-cadence-per-sefaz-pipeline.md`
- `docs/adr/0003-discovery-curated-description-gpc-sweeps.md`
- `docs/adr/0004-observability-stack.md`

### 15.2 Industry standards cited

- McCabe, T.J. (1976). "A Complexity Measure". _IEEE Transactions on Software Engineering_. SE-2 (4): 308–320 — cyclomatic complexity 10 threshold
- Watson, A.H. & McCabe, T.J. (1996). NIST Special Publication 500-235 — defect rate 3× above complexity 10
- Campbell, G.A. (2018). "Cognitive Complexity" SonarSource whitepaper — cognitive complexity 15 threshold
- Martin, R.C. (2008). _Clean Code: A Handbook of Agile Software Craftsmanship_. Prentice Hall — function length, parameter count
- Kimball, R. & Ross, M. (2013). _The Data Warehouse Toolkit_ (3rd ed.) — SCD Type 2 pattern
- Twelve-Factor App methodology (heroku.com/12factor) — config in env, separation of secrets
- OWASP Secrets Management Cheat Sheet
- Postgres docs — explicit warning against `money` and `double precision` for currency
- Conventional Commits 1.0.0 specification (conventionalcommits.org)
- Linux Kernel coding style (Documentation/process/coding-style.rst) — indentation depth, function length norms

### 15.3 Tooling used

- NestJS 11, TypeScript 5.6, Node 22 LTS
- Drizzle ORM, Drizzle Kit, postgres-js
- BullMQ 5, Bull Board, Redis 7
- Vitest 2, MSW 2, Testcontainers
- ESLint 9 flat, Prettier 3, sonarjs plugin, typescript-eslint
- Husky, lint-staged, commitlint
- pino, nestjs-pino
- Zod 3
- nest-commander
- Postgres 16
