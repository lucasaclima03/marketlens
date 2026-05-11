---
adr: 0002
status: Accepted
date: 2026-05-11
deciders: [Lucas Almeida]
tags: [ingestion, sefaz-al, cadence, polling]
supersedes: null
superseded-by: null
---

# Fixed cron cadence per SEFAZ pipeline, calibrated to delay floor

## Context and problem statement

The SEFAZ AL Economiza Alagoas API exposes only synchronous pull endpoints (`POST /produto/pesquisa`, `POST /combustivel/pesquisa`) — no webhook, no streaming, no CDC. MarketLens runs three ingestion pipelines against it: `CuratedSeed` (~300 essential and high-rotation SKUs), `Discovery` (broad category sweeps via `descricao + GPC`), and `Combustível` (six fuel types per municipality). Each pipeline needs a polling cadence that balances user-perceived freshness against load on a public service that explicitly asks consumers to "not overload our network" (SEFAZ Developer Manual v1.0, §4). Without a documented calibration anchored in empirical evidence, the cadence becomes a hidden constant tuned by intuition, with no defensible reference point when freshness regressions or load complaints surface.

## Decision drivers

- The SEFAZ-side delay floor — the gap between a fiscal note being authorized and the record appearing in the public API — is opaque and outside our control; our cadence must be calibrated _relative_ to it, not against an idealized "real-time" goal.
- SEFAZ's textual request to not overload the network — a single-developer project must not behave like a stressing consumer of a public service.
- Operational simplicity: cadence must be readable in a cron expression and debuggable when a cycle is missed; a single-dev team cannot afford an opaque dynamic scheduler.
- Calibration must be revisitable via a concrete metric, not gut feeling.
- Different pipelines have different freshness sensitivities: `CuratedSeed` feeds user-facing search, `Discovery` feeds catalog completeness, `Combustível` feeds a slow-moving but politically watched signal.

## Considered options

### Option 1: Fixed cron per pipeline (uniform 24/7)

Each pipeline runs on a constant interval via BullMQ `repeat` cron expression. `CuratedSeed` at 1h, `Discovery` at 6h, `Combustível` at 6h. The cadence does not vary by hour of day, day of week, or per-SKU history.

**Pros:**

- Trivial to reason about, predict, and alarm on (jobs-per-hour is constant).
- Failure is visible: a missing `last_run_at` is a one-glance diagnosis.
- Calibration reduces to one constant per pipeline — easy to revisit as a future ADR input.
- Matches the default pattern of public ETL projects (IBGE PNADc, Banco Central SGS, dados.gov.br scrapers, Airflow/Prefect/Dagster examples).

**Cons:**

- Polls the early-morning window (02:00–05:00 BRT) without ingestion gain — virtually no new sales reach the SEFAZ API in that window.
- Same cadence applies to every SKU in `CuratedSeed` regardless of how often the SKU's price actually changes.
- Insensitive to seasonality (Black Friday, Carnaval, Friday evenings).

### Option 2: Adaptive polling per SKU / per query

Each SKU (or each `descricao + GPC` query) stores a `next_due_at` derived from observed price-change history. A fast-mover like `ARROZ TIO JOAO` polls hourly; a slow-mover like a niche shampoo polls every 12h. Implemented via BullMQ delayed jobs scheduled individually rather than `repeat`.

**Pros:**

- Quota concentrated where there is real signal; SEFAZ load shifts toward high-value SKUs.
- Perceived staleness on liquid SKUs is lower at the same total call budget.
- Strong foundation for multi-source future where each source has its own change profile.

**Cons:**

- Significant complexity: dynamic scheduler, `sku_polling_state` table, recalculation on every observation.
- Bootstrap problem: the first 30 days have no history, so the system falls back to a fixed cadence anyway.
- Debuggability cost: "why is this SKU stale?" requires inspecting per-SKU state instead of reading a single cron expression.
- BullMQ's `repeat` cannot recompute interval between runs — adaptive scheduling means per-SKU `add(..., { delay })` orchestration, a less-trodden pattern.

### Option 3: Hybrid window-aware cron

Same structure as Option 1, but cadence shifts by time of day. `CuratedSeed` polls every 1h between 06:00–23:00 BRT and every 4h between 23:00–06:00 BRT.

**Pros:**

- Reduces approximately 25–30% of daily calls by avoiding the dead window.
- Still readable (two cron expressions per pipeline) — modest complexity bump.
- Honors the SEFAZ "do not overload" request more visibly.

**Cons:**

- Introduces an additional calibration constant (the cutover hour) — friction in reasoning.
- Marginal saving against an already modest absolute volume (~7.2k → ~5k calls per day).
- Residual risk of missing 24h-operating supermarket sales in the dead window.

### Option 4: Demand-driven (lazy ingestion at search time)

When a user searches, if the relevant product's last fetch is older than a threshold, dispatch an ingestion job inline before returning.

**Pros:**

- Zero waste on SKUs nobody searches.
- Freshness is always near-best for queried items.

**Cons:**

- Violates the read/write separation already accepted in `CONTEXT.md` ("we hit SEFAZ only via background ingestion jobs; cache and ingestion are decoupled from user requests").
- Search latency explodes: SEFAZ calls observed at 4–28s would land on the critical user-facing path.
- Discarded by principle, not by mechanical merit.

### Options not available: push/webhook and CDC

SEFAZ AL exposes neither a webhook nor a CDC stream of fiscal-note events. Both are listed here for completeness — they remain reference patterns for future sources (for example, Receita Federal eSocial uses webhooks) but are not selectable for this source.

## Decision outcome

Chosen option: **Option 1 — fixed cron per pipeline**, with the following intervals:

- `CuratedSeed`: **every 1 hour**
- `Discovery`: **every 6 hours**
- `Combustível`: **every 6 hours**

The cadence was set by anchoring on the measured SEFAZ delay floor (see _Empirical evidence_). Faster polling cannot beat the floor; slower polling gives back perceived freshness at modest call savings. Adaptive scheduling (Option 2) is the natural next step once 30+ days of per-SKU change history exist, and is explicitly listed as a revisit trigger below.

## Consequences

**Positive:**

- Cadence is one cron expression per pipeline — readable, alarmable, and trivially modifiable.
- `CuratedSeed` worst-case staleness, given the measured SEFAZ floor of 44 minutes, is approximately 1h15min in the best case and approximately 4h25min in the p50 case — adequate for user-facing search of liquid SKUs.
- Total daily SEFAZ load for the MVP is bounded and small: approximately 7.2k `CuratedSeed` calls, a few hundred `Discovery` calls, and 72 `Combustível` calls per day.
- Decision is revisitable against a single named metric (`sefaz_observation_age_seconds`).

**Negative:**

- Polling does not adapt to per-SKU rhythm — `ARROZ TIO JOAO` and a slow-moving toiletry are polled at the same 1h cadence inside `CuratedSeed`.
- Polling does not skip the dead overnight window — approximately 25% of `CuratedSeed` calls produce no new observations.
- A future user-facing claim such as "real-time fuel prices" would require a delta ADR to promote `Combustível` from 6h to a tighter cadence.

**Neutral:**

- `CONTEXT.md` is updated in the same PR to reflect `CuratedSeed` at 1h (previously documented as 3h, pre-validation).
- Combustível schema differences (no GTIN / NCM / GPC) are not addressed here — they belong to a separate persistence-shape ADR.

## Empirical evidence

The cadence is anchored on the **SEFAZ delay floor** — the elapsed time between a fiscal note being authorized and its observation appearing in `/produto/pesquisa`. Measured 2026-05-08 with 12+ curl calls against the production API using an authorized AppToken.

Reference query: `descricao: "ARROZ TIO JOAO"`, Maceió (IBGE 2704302), `dias: 1`, 50 observations returned. The metric is `(now - max(dataVenda))` over the result set.

| Statistic | SEFAZ delay              |
| --------- | ------------------------ |
| min       | **44 minutes** (0.74h)   |
| p50       | **3h 54min** (3.94h)     |
| max       | 23h 55min (window limit) |

End-to-end staleness perceived by the user equals the SEFAZ delay plus, on average, half the polling interval. Mapping that math across candidate cadences for `CuratedSeed`:

| Cron interval   | Best case (SEFAZ floor) | p50 case      | Daily calls |
| --------------- | ----------------------- | ------------- | ----------- |
| 30 min          | ~1h                     | ~4h 10min     | ~14.4k      |
| **1h (chosen)** | **~1h 15min**           | **~4h 25min** | **~7.2k**   |
| 2h              | ~1h 45min               | ~4h 55min     | ~3.6k       |
| 3h              | ~2h 15min               | ~5h 25min     | ~2.4k       |
| 4h              | ~2h 45min               | ~5h 55min     | ~1.8k       |

The SEFAZ delay floor dominates the p50 staleness — at 1h cadence the cron contributes only 30 minutes (≈10%) of the user-perceived staleness. Going from 2h to 1h doubles the call volume to recover roughly 30 minutes of p50 staleness; going below 1h pays an equal doubling for diminishing returns against a 44-minute floor. The 1h choice captures the best-case improvement (`ARROZ` -class liquid SKUs benefit visibly) without crossing into territory where the floor renders the extra calls wasted.

For `Discovery` and `Combustível`, freshness sensitivity is lower (catalog completeness and slow-moving fuel signals respectively), and 6h is calibrated against operational simplicity (single cron, four cycles per day) rather than against the floor directly.

Supporting data:

- 12+ real SEFAZ API calls catalogued in `memory/project_sefaz_al_api_spec.md`.
- Per-call latency observed at 4–8s typical, up to 28s for broad token queries — relevant for sizing BullMQ concurrency, not for cadence directly.
- Volume probe: `descricao: "REFRIG" + gpc: "50000000"` returned 17,046 records across 341 pages — confirms `Discovery` is the bulk-load pipeline and benefits more from low cadence than from frequent runs.

## Validation criteria

Revisit this decision when **any** of the following holds. The primary measurement signal is `sefaz_observation_age_seconds` — a histogram of `(now - max(dataVenda))` recorded at each successful fetch, labelled by `query_type`.

| Trigger                                                        | Threshold                        | Action                                                                                          |
| -------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `sefaz_request_total{result="rate_limited_or_5xx_persistent"}` | > 5% over any rolling 24h window | Revisit (likely: extend `CuratedSeed` cadence)                                                  |
| Direct communication from SEFAZ requesting reduced load        | any                              | Reduce immediately, formalize revisit afterwards                                                |
| `sefaz_observation_age_seconds` p95 (`CuratedSeed`)            | < 1h sustained over 7 days       | SEFAZ is fast — consider 30min for `CuratedSeed`                                                |
| `sefaz_observation_age_seconds` p95 (`CuratedSeed`)            | > 5h sustained over 30 days      | Floor dominates — consider 2h for `CuratedSeed` (carry less load for negligible perceived loss) |
| Addition of a second ingestion source (e.g. SEFAZ SP)          | first new source merges          | Reopen to coordinate cadence between sources                                                    |
| Cadence checkpoint review                                      | 90 days after production deploy  | Review actual vs predicted staleness regardless of triggers above                               |

Adaptive polling (Option 2) is the expected next architectural step once at least 30 days of per-SKU change history exist.

## More information

- Related ADRs: ADR-0001 (multi-source ACL — establishes that cadence lives per-source).
- Memory: `project_sefaz_al_api_spec.md` (validation calls, delay-floor measurement), `project_curated_seed_strategy.md` (CuratedSeed scope), `project_pending_discussions.md` (backfill and combustível-schema decisions deferred to separate ADRs).
- Glossary: `CONTEXT.md` §§ "Sources & external boundary", "Ingestion" — `CONTEXT.md` is updated in the same PR to reflect `CuratedSeed` at 1h.
- External references: SEFAZ AL Manual de Orientação do Desenvolvedor v1.0 (March 2023), §4 (request to not overload), §5 (data quality caveats).
