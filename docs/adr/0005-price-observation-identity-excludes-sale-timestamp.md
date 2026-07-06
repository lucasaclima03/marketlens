---
adr: 0005
status: Accepted
date: 2026-07-06
deciders: [Lucas Almeida]
tags: [ingestion, persistence, scd2, domain]
supersedes: null
superseded-by: null
---

# PriceObservation identity excludes the sale timestamp

## Context and problem statement

A `PriceObservation` is versioned via SCD Type 2, and its equality predicate — the rule that decides whether a re-fetch _extends_ the current row or _supersedes_ it with a new one — was defined in `CONTEXT.md` as the tuple `(declared_value, sale_value, sold_at)`. The implementation follows that contract faithfully: a re-fetch whose `sold_at` differs from the current row produces a `price_change` outcome even when both prices are identical.

Empirical probing of the SEFAZ AL API (2026-07-06) shows that the source returns, for each `(product, establishment)` pair, only the **most recent sale event** in the query window — and `sold_at` therefore advances every time a new sale occurs, regardless of whether the price moved. Combined with the 1-hour `CuratedSeed` cadence (ADR-0002), the current predicate turns every new sale of a liquid SKU at an unchanged price into a spurious SCD2 supersession: up to 24 new rows per day per `(product, establishment)` pair, each emitting a false `PriceObservationCreated{kind: 'price_change'}` event. At MVP scale (~300 SKUs, dozens of establishments each) this produces hundreds of thousands of no-information rows per month, starves the `extended` path into irrelevance for liquid SKUs, and renders the price-change signal — the core product value — unusable.

The root cause is a category error in the identity, not in the code: `sold_at` is the timestamp of a **sale event** at the source, while `PriceObservation` models a **price state**. If nothing is done, the price history table becomes a poll log.

## Decision drivers

- The product promise is price comparison and price-change history; the `price_change` outcome must mean "the price actually changed".
- SEFAZ returns sale events with monotonically advancing timestamps at unchanged prices — verified empirically, not assumed.
- Storage and event volume must scale with actual price volatility, not with polling frequency (ADR-0002 fixes cadence at 1h).
- The SEFAZ per-pair deduplication behavior (one latest sale per `(product, establishment)` per response) is observed but **not documented** in the SEFAZ manual — the pipeline must not silently depend on it.
- Single-developer project: the fix must not introduce a new pipeline stage or a new table.

## Considered options

### Option 1: Remove `sold_at` from the equality predicate; carry it forward on the current row

Equality becomes `(declared_value, sale_value)`. When a re-fetch confirms the same price with a newer `sold_at`, the current row is updated in place (`last_seen_at` and `sold_at`, the latter only moving forward) and the outcome is `extended`. A new row is created only when the price actually differs. `fetched_at` keeps its immutability and now means "first time we observed this price level". Two guard rules complete the semantics: (a) within one fetched page, if multiple items map to the same `(product, establishment)`, only the one with the greatest `sold_at` proceeds to `persist` (defensive reduce — SEFAZ already behaves this way, but the behavior is undocumented); (b) `persist` never supersedes or updates the current row from a sale event **older** than the row's `sold_at` — such items are counted as `stale` in `IngestionResult` and dropped.

**Pros:**

- `price_change` regains its literal meaning; row count scales with price volatility.
- No schema migration: purely behavioral (`sold_at` becomes mutable on the current row).
- The current row always answers "what is the latest known price, and when was it last sold?" in one read.
- Guards make the pipeline robust to the undocumented SEFAZ dedup contract changing.

**Cons:**

- Intermediate `sold_at` values at an unchanged price are not preserved (only the most recent one). Sale-frequency analytics would need a different mechanism.
- `sold_at` mutability is a subtle semantic: the column is "most recent sale at this price level", not "the sale that created this row".

### Option 2: Keep `sold_at` in the predicate (status quo)

Every new sale event creates a new SCD2 row, preserving each observed `sold_at` as its own row.

**Pros:**

- Rows are immutable after creation (except `last_seen_at`, `valid_until`).
- Preserves every sale timestamp the source ever showed us.

**Cons:**

- Row volume driven by polling cadence × sale frequency, not by price changes — the measured profile (constant prices, advancing timestamps) makes this the dominant, pathological case.
- `price_change` events fire without a price change; the `extended` path almost never triggers for liquid SKUs.
- The "history" is not a price history; every consumer must re-deduplicate.

### Option 3: Separate `sale_events` table (event-sourcing style)

Persist each sale event append-only in its own table; derive `PriceObservation` as a projection.

**Pros:**

- Highest fidelity to what the source actually publishes; enables intra-day sale-frequency analytics.

**Cons:**

- New table, new projection logic, new retention policy — a second persistence model for a signal (individual sale events) no MVP feature consumes.
- SEFAZ already collapses sale events per pair per window, so the "event stream" would be sparse and poll-shaped anyway.

## Decision outcome

Chosen option: **Option 1 — remove `sold_at` from the equality predicate and carry it forward on the current row**, with the in-page reduce and the stale-event guard as part of the same decision.

We will define `PriceObservation` identity as `(declared_value, sale_value)` per `(product_id, establishment_id)`, update `sold_at` in place (forward-only) on re-confirmation, and count in-page duplicates and out-of-order sale events as `stale` in `IngestionResult`. `CONTEXT.md` § PriceObservation and § Domain events are amended in the same pull request.

## Consequences

**Positive:**

- `PriceObservationCreated{kind: 'price_change'}` fires only on actual price changes; the counter becomes a trustworthy product signal.
- Table growth is bounded by price volatility; the `extended` path does its job for liquid SKUs.
- The pipeline no longer depends on the undocumented SEFAZ per-pair dedup behavior (reduce guard), and cannot be corrupted by out-of-order sale events (stale guard).

**Negative:**

- Intermediate sale timestamps at an unchanged price are discarded; only the most recent is kept. Any future sale-frequency feature reopens Option 3.
- `sold_at` on the current row is mutable, which weakens the "row = immutable measurement" intuition; the precise semantics live in `CONTEXT.md` and the schema comment.

**Neutral:**

- `PriceObservationExtended` now covers two situations — an identical re-fetch and a new sale at the same price. The payload does not distinguish them (no consumer needs it; discarded as YAGNI, revisit if a listener ever does).
- `IngestionResult` gains a `stale` counter alongside `fetched/persisted/extended/rejected/skipped`.
- Existing repository tests that encode "different `sold_at` produces `price_change`" flip to encode the new predicate.
- No database migration is required; the partial unique index on the current row is unaffected.

## Empirical evidence

Probes against the production SEFAZ AL API on 2026-07-06 (same endpoint, headers, and body shape the pipeline uses).

**1. SEFAZ returns one record per `(product, establishment)` pair — the most recent sale.**

| Query                                                                                        | Records | Distinct pairs | Pairs with >1 sale |
| -------------------------------------------------------------------------------------------- | ------: | -------------: | -----------------: |
| `gtin: 7894900011517` (Coca-Cola 2L), Maceió, `dias: 1`                                      |      52 |             52 |              **0** |
| Same, `dias: 3` (3× window would force repeats if raw events were returned)                  |      71 |             71 |              **0** |
| `descricao: "REFRIG" + gpc: 50000000`, page 1 of 80 (7,905 total), keyed by `(codigo, cnpj)` |     100 |            100 |              **0** |

The only repeated `(gtin, cnpj)` keys in the sweep were distinct products sharing `gtin: "0"` (no-GTIN items — different `codigo` and `descricao`), not repeated sales.

**2. `sold_at` advances while prices stay constant.** Adjacent no-GTIN items from the same establishment show the pattern directly: sales at 16:04 and 11:26 the next day, both at 1.29; sales at 17:14 and 18:05, both at 0.99. A new sale at an unchanged price is the common case, and under the status-quo predicate each one becomes a `price_change` row at the next poll.

**3. Arithmetic consequence at ADR-0002 cadence.** With hourly polling and a liquid SKU selling at least hourly, the status quo creates up to 24 rows/day per pair at a constant price. The `gtin` probe found 71 establishments selling one SKU in one municipality — one SKU alone could produce ~1,700 spurious rows/day.

## Validation criteria

| Trigger                                      | Signal                                                           | Threshold                                  | Action                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| SEFAZ dedup contract breaks                  | `stale` count in `IngestionResult` (in-page duplicates observed) | consistently > 0 for `CuratedSeed` queries | Confirm reduce guard is absorbing it; no decision change needed — that is its purpose                      |
| Price-change signal still noisy              | ratio `price_change` / `extended` per liquid SKU after deploy    | anomalously high vs. manual spot-checks    | Investigate whether declared/sale value jitter (e.g., rounding at source) needs tolerance in the predicate |
| Sale-frequency analytics requirement appears | product roadmap                                                  | first feature needing per-sale granularity | Reopen Option 3 (`sale_events` table) as a delta ADR                                                       |

Cadence: review alongside the ADR-0002 90-day post-deploy checkpoint.

## More information

- Related ADRs: ADR-0002 (1h cadence multiplies the status-quo row churn), ADR-0003 (Discovery sweeps surface no-GTIN items as `gtin: "0"` — their handling is deferred to the Discovery implementation ADR, not decided here).
- Glossary entries: `CONTEXT.md` § PriceObservation (equality predicate and timestamp semantics amended in the same PR), § Domain events (`PriceObservationExtended` fires-when amended).
- External references: SEFAZ AL Manual de Orientação do Desenvolvedor v1.0 (March 2023) — the per-pair deduplication behavior observed above is not documented there, which motivates the defensive guards.
