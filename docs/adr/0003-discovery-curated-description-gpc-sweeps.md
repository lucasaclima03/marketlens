---
adr: 0003
status: Accepted
date: 2026-05-11
deciders: [Lucas Almeida]
tags: [ingestion, sefaz-al, discovery, catalog]
supersedes: null
superseded-by: null
---

# Discovery uses curated description+GPC sweeps as finder and long-tail refresher

## Context and problem statement

`Discovery` is the ingestion pipeline that keeps the catalog growing — surfacing SKUs not yet in `CuratedSeed` and refreshing prices for the long tail of SKUs that nobody curated by hand. The original design (P15: "`gpc-crawl` varre toda categoria GPC") assumed SEFAZ would accept GPC-only queries to enumerate everything under each segment. Validation on 2026-05-08 invalidated that assumption: GPC alone is rejected with `HTTP 400 "Critério de pesquisa de produto não informado."`. Same for NCM. The API requires either `gtin` or `descricao` ≥3 chars as the primary criterion; GPC and NCM only function as filters. This forces a redesign of how Discovery is seeded.

A second realization surfaced from the same validation. A single broad query — `descricao: "REFRIG" + gpc: "50000000"` — returns 17,046 observations covering 22 distinct GTINs in Maceió. This means Discovery does not merely _find_ new SKUs; each sweep incidentally _refreshes prices_ for every SKU caught in its net. Without making this dual role explicit, future readers cannot understand why MarketLens does not poll discovered SKUs individually (the answer is that Discovery already covers them as a side effect).

If both questions stayed unanswered, every new SKU added to the catalog would either go stale immediately, or force the project into a per-SKU adaptive scheduler — the very complexity ADR-0002 deliberately deferred.

## Decision drivers

- The SEFAZ API constraint is hard: queries must carry `gtin` or `descricao` (≥3 chars) as primary criterion. GPC and NCM only filter. Seed shape is forced into this constraint.
- Catalog must grow over time without an unbounded SEFAZ call budget — Discovery cost must scale with curated query count, not with catalog size.
- Long-tail freshness must come from somewhere; either a separate refresher pipeline or as a side effect of Discovery sweeps.
- Single-developer project: curation must be inspectable and reviewable via PR, scheduling complexity must be bounded.
- False positives in description-token matching (for example, `"PAO"` catching `"MOPAO"`) must not pollute domain entities; categorization must come from structured fields (GTIN, NCM, GPC) that SEFAZ returns per observation, never from the query token.
- Decision must be revisitable when production data exposes coverage gaps or curation overhead.

## Considered options

### Option 1: Curated YAML of `(description_token, gpc_code)` pairs, with Discovery serving both finder and long-tail refresher roles (Modelo Z)

A human-curated file (`config/discovery-seeds.yaml`) lists pairs of a broad description token and a GPC filter. Each entry drives one Discovery query per cycle. SEFAZ returns every observation matching the filter, simultaneously refreshing the price for every SKU in the result and adding new GTINs to the catalog when seen for the first time. Token selection follows six rules (family root, ≥4 chars, substring-unique ≥80% in pre-validation, uppercase, no stop words / no units, vendor-friendly orthography).

**Pros:**

- Coherent with the curated-YAML pattern already in use for `CuratedSeed`.
- Determinístico: every Discovery query is auditable by reading the YAML file.
- Per-query yield is high (the validation showed 22 distinct GTINs from a single REFRIG sweep) — efficient quota usage relative to per-SKU polling.
- New brands entering the market are auto-surfaced when family-root tokens are used (REFRIG catches Coca, Pepsi, Dolly, regional entrants).
- Defends against false positives at the persistence boundary via GTIN, NCM, GPC structured fields — not via query-token filtering.
- Single mechanism handles both roles; aligns with SEFAZ API's natural sweep behavior.

**Cons:**

- Manual curation effort to establish and maintain seeds (estimated ~40 entries for MVP).
- Token selection requires curl-based pre-validation (rule #3) before adding a seed.
- Categories of interest that are not seeded are invisible to the system until detected lazily by M1/M3 metrics.
- False positives DO get ingested as legitimate Products (correctly classified under their real NCM/GPC), inflating catalog cardinality with peripheral data.

### Option 2: Auto-derived seeds from `CuratedSeed` product descriptions

A weekly job analyses descriptions of products already in `CuratedSeed`, extracts frequent tokens, and proposes new seeds automatically.

**Pros:**

- Zero manual curation after initial bootstrap.
- Tokens grounded in real SEFAZ data, not human guessing.

**Cons:**

- Bootstrap problem: the first 30 days have no `CuratedSeed`-derived data to mine.
- Cannot discover categories _not_ already in `CuratedSeed` — exactly the opposite of Discovery's purpose, which is to surface unknown SKUs.
- Opacity: "why did `MASTIGAVEL` become a seed?" requires debugging the derivation pipeline.

### Option 3: GPC label tokens as descriptions

Use the human-readable labels from SEFAZ's Anexo III (for example, "ALIMENTOS", "BEBIDAS", "TABACO") as the description token, paired with the matching GPC code.

**Pros:**

- Zero curation — labels come directly from the manual.
- Coverage matches the GPC hierarchy by construction.

**Cons:**

- Tokens are too generic: `"ALIMENTOS"` likely matches thousands of descriptions and may trigger the SEFAZ broad-token latency observed during validation (token-combined queries hit 28s).
- Limits Discovery granularity to the GPC level — loses purpose-built tokens like `"REFRIG"` that proved highly efficient (22 GTINs from one call) in the validation.
- Untested with SEFAZ; cannot guarantee match-quality constraints are satisfied.

### Option 4: Hybrid (Option 1 curated baseline + Option 2 auto-suggested PRs)

A weekly job runs Option 2's extraction logic on observations from the last 30 days, scores candidates by frequency × distinct GTIN count × inverse coverage, and opens a GitHub Action PR with proposed additions to the YAML. The maintainer reviews each suggestion line-by-line; rejected tokens go to a `rejected-seed-tokens.yaml` anti-spam list.

**Pros:**

- Best of both worlds: human control plus a feedback loop that surfaces forgotten coverage gaps.
- Foundation for scaling beyond a single curator.

**Cons:**

- Extra subsystem (~200-400 LOC plus weekly job, scoring algorithm, proposal-builder, rejection-tracking) — premature complexity for a single-developer project with ~40 seeds.
- Two systems to maintain (curated YAML and auto-proposal pipeline).
- Bootstrap problem persists for the first 30 days.

### Option 5: Discovery as finder only, with a separate per-SKU refresher pipeline for the long tail

Split the roles. Discovery only inserts new GTINs into the catalog. A second pipeline (`LongTailRefresher`) polls each cataloged SKU individually on its own cadence.

**Pros:**

- Explicit role separation, clean single-responsibility per pipeline.

**Cons:**

- Per-SKU polling scales with catalog size: as the catalog grows from 300 to 5,000 SKUs, SEFAZ calls grow proportionally (5,000 SKUs ÷ 6h cadence = ~20,000 calls/day just for refresh, vs. ~600 for Modelo Z).
- Ignores SEFAZ's natural sweep behaviour — each broad query already refreshes every SKU it returns; per-SKU polling re-fetches the same data inefficiently.
- Reintroduces the adaptive-scheduling complexity that ADR-0002 deliberately deferred.

### Discarded: GPC-only or NCM-only queries

The original P15 plan. SEFAZ returns HTTP 400 with `"Critério de pesquisa de produto não informado."`. Not viable.

## Decision outcome

Chosen option: **Option 1 — curated YAML of `(description_token, gpc_code)` pairs, with Discovery serving as both new-SKU finder and long-tail price refresher (Modelo Z)**.

Concretely:

- Seeds live in `config/discovery-seeds.yaml`.
- Each entry has shape `{ token: string, gpc: string, priority: high | med | low }`.
- The BullMQ queue is named `discovery-crawl` (renamed from the original `gpc-crawl` to reflect the post-validation reality).
- Discovery runs at 6h cadence per ADR-0002.
- MVP target is approximately 40 seeds covering four GPC segments: 50000000 (Alimentos / Bebidas / Tabaco), 47000000 (Higiene / Limpeza), 53000000 (Higiene Pessoal / Beleza), 51000000 (Saúde).
- Combustível is NOT a `DiscoverySeed` — it has its own endpoint (`/combustivel/pesquisa`) keyed by `tipoCombustivel`, requiring no description.

Token selection follows six rules:

1. **Family root, not brand.** `REFRIG` is a family root; `COCA` is a brand. Family roots auto-discover new brands; brand tokens do not.
2. **≥4 characters.** SEFAZ minimum is 3, but 4+ reduces substring collisions.
3. **Substring-unique in ≥80% of pre-validation hits.** Test the token via curl against SEFAZ before adding; if `CAMIL` returns 793 records of which a significant share are `"CAMILA"`, reject the token.
4. **Uppercase.** Aligns with SEFAZ description conventions.
5. **No SEFAZ stop words (`da, de, do, na, no`) and no unit suffixes (`KG`, `ML`, `L`).**
6. **Vendor-friendly orthography.** Use the form vendors actually type in their PDV — `MACARRAO` without the tilde, not `MACARRÃO`.

## Consequences

**Positive:**

- One mechanism covers both finder and long-tail refresher, aligned with SEFAZ's natural sweep behaviour.
- Quota usage is bounded by curated seed count (~40), not by catalog size — adding 10,000 SKUs costs zero additional SEFAZ calls.
- Determinism: every query is in `discovery-seeds.yaml`; PR diffs make every coverage change reviewable.
- False positives are persisted as their own correctly-categorized Products (via SEFAZ-returned GTIN, NCM, GPC) — they enrich the catalog instead of corrupting it.
- New brands and regional entrants are auto-surfaced when family-root tokens are used.

**Negative:**

- Manual curation overhead exists. M4 metric tracks whether it is becoming costly enough to justify Option 4 (hybrid).
- Categories without seeds are invisible until M1 or M3 metrics surface the gap.
- Token selection requires curl-based pre-validation before adding to YAML — small per-seed cost.
- Catalog cardinality grows faster than strictly necessary (false positives are persisted).

**Neutral:**

- BullMQ queue is named `discovery-crawl`. The original `gpc-crawl` name is retired and listed in `CONTEXT.md` § Discovery `_Avoid_` block.
- `CONTEXT.md` § Ingestion is updated in the same PR with new `Discovery` and `DiscoverySeed` entries; `CuratedSeed` entry is amended to reference Discovery as its complement.
- Promotion criteria (Discovery SKU → `CuratedSeed`) are deferred to a future ADR — manual via YAML edit until then.
- Stale-SKU lifecycle (a SKU that no DiscoverySeed catches anymore — the "fantasma" case) is deferred to a future ADR; for MVP these SKUs simply stop receiving updates and are detectable via M2.
- Observability tooling for M1–M4 is defined in ADR-0004.

## Empirical evidence

Three findings from the 2026-05-08 SEFAZ validation drive this decision.

**1. GPC-only and NCM-only queries are rejected.**

```
POST /produto/pesquisa
{ "produto": { "gpc": "50000000" }, "estabelecimento": {...}, "dias": 1 }
→ HTTP 400 { "message": "Critério de pesquisa de produto não informado." }
```

Identical response for `{ "ncm": "22021000" }`. SEFAZ requires `gtin` or `descricao` (≥3 chars) as primary criterion. This invalidated the P15 plan in a single curl call.

**2. Description+GPC works and returns broad sweeps with high yield.**

| Query                                             | Records | Pages | Distinct GTINs |
| ------------------------------------------------- | ------: | ----: | -------------: |
| `descricao: "REFRIG"` + `gpc: "50000000"`         |  17,046 |   341 |         **22** |
| `descricao: "FEIJAO"` + `ncm: "07133311"`         |      31 |     1 |             10 |
| `descricao: "FEIJAO CARIOCA"` + `ncm: "07133311"` |       7 |     1 |              5 |
| `descricao: "ARROZ TIO JOAO"`                     |      50 |     1 |              1 |

The REFRIG query alone covered every refrigerant SKU observed in Maceió in the time window — confirming that one Discovery sweep can refresh an entire category in a single API call. This directly motivates Modelo Z.

**3. Description-token substring matching produces false positives.**

```
descricao: "CAMIL" → 793 records, including "CAMILA" (unrelated to the CAMIL brand of rice)
descricao: "FEIJAO CAMIL" → 65 records, 8 GTINs (precise; AND-match works)
```

Single-token short strings collide; multi-token AND queries are precise. This validates rule #3 (substring-unique ≥80%) — CAMIL fails it as a single-token seed.

## Validation criteria

Four metrics drive revisit. All measurements are emitted and rendered via the observability stack defined in ADR-0004.

| Metric                                                    | Definition                                                                                                        | Threshold                                        | Action                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| **M1 — `curated_skus_without_recent_discovery_coverage`** | Count of `CuratedSeed` GTINs not seen in any Discovery response in the last 7 days                                | > 30 SKUs (10% of CuratedSeed) sustained 14 days | Review which GPC / description tokens are under-seeded; add 1–3 new entries |
| **M2 — `product_last_observation_age_hours` p95**         | p95 of `(now - max(observation.fetched_at))` per Product                                                          | > 24h sustained 14 days                          | Inspect tail; likely fantasma SKUs (defer) or seed gap                      |
| **M3 — `gpc_segments_without_seed_coverage`**             | Any GPC with >100 catalogued SKUs but zero `DiscoverySeed`                                                        | event-driven                                     | Add at least one seed for that GPC                                          |
| **M4 — `manual_seed_curation_time_hours_per_month`**      | Manual heuristic via `git log config/discovery-seeds.yaml --since='30 days ago' \| wc -l` plus self-reported time | > 8h/month sustained 3 months                    | Consider building Option 4 (hybrid auto-suggester)                          |

Combined trigger to reconsider Option 4 (hybrid): **M4 high AND (M1 high OR M2 high)**. Each alone is not sufficient — high M4 with healthy M1/M2 means over-curation; high M1/M2 with low M4 means inattention rather than capacity ceiling.

Cadence: review at 90 days post-deploy regardless of triggers.

## More information

- Related ADRs:
  - ADR-0001 (multi-source ACL) — `DiscoverySeed` and Discovery code live under `src/sources/sefaz-al/discovery/`.
  - ADR-0002 (fixed cron cadence) — Discovery runs at the 6h cadence cravada there.
  - ADR-0004 (Observability stack) — formalizes the metric storage and rendering referenced in _Validation criteria_.
  - Future ADR — Promotion criteria from Discovery to `CuratedSeed`.
  - Future ADR — Stale SKU (fantasma) lifecycle and the role of `last_observed_at` on `Product`.
- Memory: `project_sefaz_al_api_spec.md` (validation calls, false-positive evidence), `project_curated_seed_strategy.md`, `project_search_strategy.md`.
- Glossary: `CONTEXT.md` §§ "Ingestion" — `Discovery` and `DiscoverySeed` entries added in the same PR.
- External references: SEFAZ AL Manual de Orientação do Desenvolvedor v1.0 (March 2023), §4 (request not to overload), Anexo III (GPC segments).
