# MarketLens

A multi-source price intelligence aggregator for retail prices in Brazil. Wraps the SEFAZ Alagoas Economiza Alagoas public API — the only Brazilian state with a public NFC-e price API — as the first source, providing fast, resilient, observable access plus normalization, history, and cross-establishment comparison. Architecture supports additional sources via Anti-Corruption Layer per source.

## Language

### Sources & external boundary

**SefazAlPriceItem**:
The shape of a single element in the `conteudo[]` array returned by `POST /produto/pesquisa` of the SEFAZ AL Economiza Alagoas API. A boundary type (Zod schema), not a domain entity.
_Avoid_: SefazProduct, ProductDTO, ResponseItem

**SefazAlPriceResponse**:
The full response envelope from SEFAZ AL pesquisa, including pagination fields (`totalRegistros`, `totalPaginas`, `pagina`, `primeiraPagina`, `ultimaPagina`) and `conteudo[]`.

**RawPriceObservation**:
The canonical, source-agnostic input shape produced by every source adapter. Pre-normalization. Carries `sourceId` so its origin is preserved. Lives in memory only — not persisted.
_Avoid_: ExternalProductObservation, IngestedItem, RawProduct

### Domain entities (persisted)

**Product**:
A canonical retail SKU identified primarily by normalized EAN (strip leading zero + check digit valid). When EAN is null, identified by a heuristic hash over `(ncm, brand, gramature, normalized_description)` restricted to the same NCM. One Product unifies all PriceObservations of the same SKU across all Establishments.
_Avoid_: SKU, Item, CanonicalProduct

**PriceObservation**:
A measurement we made: this Product was seen at this Establishment at this price level. Versioned via SCD Type 2 with three timestamps:

- `fetched_at` records the first time we observed the `(declared_value, sale_value)` pair for this `(Product, Establishment)` (immutable per row)
- `last_seen_at` records the most recent time we re-confirmed the same price level (updated in place, no new row inserted)
- `valid_until` is `'infinity'::timestamptz` for the current row and is set to `now()` when a different price level supersedes it

Equality across observations is on `(declared_value, sale_value)` — a **price state**, not a sale event (ADR-0005). `sold_at` is the timestamp of the most recent sale observed at this price level: it moves forward in place on the current row when a new sale at the same price is observed, and never moves backward (sale events older than the current row's `sold_at` are counted as `stale` and dropped). `fetched_at` is our wall-clock, not source state, so it is NOT part of the predicate either. Carries both `declared_value` (issuer-declared) and `sale_value` (actual sale, post-discount).
_Avoid_: Snapshot, PriceSnapshot, PriceRecord, PriceQuote, PriceReading

**Establishment**:
A physical retail location identified by full CNPJ (14 digits — branch, not root). Has `legal_name` (razão social), `trade_name` (nome fantasia), structured address (`street`, `neighborhood`, `postal_code`), `ibge_code`, and lat/long. One Establishment per CNPJ.
_Avoid_: Store, Vendor, Merchant, Loja, Mercado

**Chain**:
A retail brand that operates one or more Establishments under the same `cnpj_root` (8 digits). One Chain corresponds to one `cnpj_root`. Curated manually via YAML mapping (top 20 retailers in Alagoas seeded initially). An Establishment may have `chain_id = null` when its `cnpj_root` is not curated (mom-and-pop stores, single-location operators).
_Avoid_: Brand, Retailer, Group, Rede

### Categorization

**Category**:
The product category exposed publicly. Sourced from the GPC (Global Product Classification) segment code returned by SEFAZ (Anexo III, 41 segments). Examples: "Alimentos / Bebidas / Tabaco", "Higiene / Cuidados Pessoais / Beleza".
_Avoid_: Categoria, Tipo, GpcSegment (in code we use `category`; "GPC" surfaces only in `category_gpc_code`)

**FiscalCode**:
The fiscal classification code (Nomenclatura Comum do Mercosul, 8 digits). Internal use only: outlier detection, fiscal aggregations, fallback when GPC is missing.
_Avoid_: NCM (in conversation OK; in code use `fiscalCode`)

### Geographic

**Municipality**:
A city-level administrative unit, identified by 7-digit IBGE code (e.g., Maceió = `2704302`). Anexo II of the SEFAZ AL manual lists all 102 Alagoas municipalities. The MVP covers Maceió, Arapiraca, and Rio Largo.
_Avoid_: City, Cidade

### Ingestion

**CuratedSeed**:
The curated list (~300 SKUs) of essential basket items + popular SKUs that drives the high-cadence (1h) ingestion job. Each entry is a GTIN polled individually. Stored as YAML in the repo. Sourced from DIEESE basic basket + manual curation of top items. Complements **Discovery** (long-tail refresher).
_Avoid_: Cesta básica (translates to user-facing ShoppingBasket), Seed list, Watchlist

**Discovery**:
The ingestion pipeline that refreshes long-tail prices and surfaces previously-unknown SKUs in a single mechanism. Each Discovery query is a wide-net sweep driven by a **DiscoverySeed**; SEFAZ returns every observation matching the filter, refreshing the price of every SKU in the result AND adding new GTINs to the catalog when seen. Complements CuratedSeed (which polls ~300 high-priority SKUs by GTIN at higher cadence). SKUs in GPC categories not covered by any DiscoverySeed are not refreshed after their first observation.
_Avoid_: Crawl (was the original name `gpc-crawl`, replaced post-validation), Sweep, Scan

**DiscoverySeed**:
A curated `(description_token, gpc_code)` pair in YAML that drives one Discovery query. The token must be ≥3 chars (SEFAZ constraint) and broad enough to match many SKUs in the segment. Example: `("REFRIG", "50000000")` returned 17,046 observations across 22 distinct GTINs in Maceió during validation.
_Avoid_: GpcSeed, CrawlSeed, DiscoveryQuery

**ShoppingBasket** (roadmap, not MVP):
A user-facing collection of products that the user wants to compare totals across establishments. Different concept from CuratedSeed.
_Avoid_: Basket, Cart, Cesta

### Quality

**HardRejection**:
Input rejected before persistence based on absolute rules (e.g., `valor_venda < 0.10`, `valor_max > 100 * valor_min`). Stored in `ingestion_failures` with reason; never reaches `price_observations`.
_Avoid_: Reject, Drop, Discard

**QualityFlag**:
A column on PriceObservation indicating soft anomaly detection. Values: `null` (clean), `'price_anomaly'` (z-score > 3.5 vs. recent history), `'ncm_mismatch'` (Establishment dominant NCM divergent from observation NCM). Public API filters `quality_flag IS NULL` by default.
_Avoid_: Outlier, Anomaly (these can refer to either HardRejection or QualityFlag — `quality_flag` is the precise term)

## Operations

The pipeline uses a tight vocabulary of 8 verbs. Each verb maps to one canonical method name; synonyms are forbidden by convention.

| Verb          | Layer                                               | Method                                         | Returns                                      |
| ------------- | --------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| **fetch**     | Source client                                       | `SefazAlClient.fetch(query)`                   | `SefazAlPriceResponse`                       |
| **adapt**     | Source adapter (Anti-Corruption Layer)              | `SefazAlAdapter.adapt(item)`                   | `RawPriceObservation`                        |
| **validate**  | Validation layer                                    | `Validator.validate(raw)`                      | `Result<RawPriceObservation, HardRejection>` |
| **normalize** | Normalization service                               | `NormalizationService.normalize(raw)`          | `{ product, observationData }`               |
| **persist**   | Repository                                          | `Repository.persist(product, observationData)` | `PriceObservation`                           |
| **flag**      | Quality detector (async, via domain event listener) | `OutlierDetector.flag(observation)`            | mutates `quality_flag`                       |
| **ingest**    | Orchestrator                                        | `IngestionService.ingest(query)`               | `IngestionResult`                            |
| **search**    | Read-side service                                   | `SearchService.search(query)`                  | `Page<Product>`                              |

### Eliminated synonyms

- `enrich` — not a separate verb. Enrichment (category label from GPC, canonical description selection) happens inside **normalize**.
- `dedupe` — not a separate verb. Deduplication is the SCD Type 2 behavior of **persist** (extends the current row on identical price levels). The in-page reduce (keep only the newest sale event per `(Product, Establishment)` per fetched page, ADR-0005) is likewise an internal step of **ingest**, not a pipeline verb.
- `match` — not a separate verb. Matching to existing Product happens inside **normalize**.
- `reject` — not a separate verb. Rejection is the failure outcome of **validate**, returned as `Result<_, HardRejection>` and handled by the caller (typically by recording in `ingestion_failures`).
- `mark` — not a separate verb. Soft quality marks use **flag** (consistent with `quality_flag` column).
- `crawl` — not a pipeline verb. It is a job-orchestration strategy that calls **ingest** repeatedly (see the `gpc-crawl` BullMQ job).

### Domain events

The pipeline emits 4 events via `EventEmitterModule`. Listeners subscribe asynchronously (metrics, structured logs, future alerts).

| Event                          | Fires when                                                                                                                                                                             | Payload                                                                                                    | Typical listener                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **`PriceObservationCreated`**  | `persist` inserts a new PriceObservation row (Case A — no prior current row — or Case C — a different **price level** supersedes the prior current row)                                | `{ observation_id, product_id, establishment_id, source_id, kind: 'first_observation' \| 'price_change' }` | Increment `marketlens_price_observations_created_total{kind, source_id}`                   |
| **`PriceObservationExtended`** | `persist` re-confirms the current price level (Case B) — either an identical re-fetch or a newer sale at the same price; `last_seen_at` (and `sold_at`, forward-only) updated in place | `{ observation_id, product_id, establishment_id, source_id }`                                              | Increment `marketlens_price_observations_extended_total{source_id}`                        |
| **`IngestionRejected`**        | `validate` returns `Err(HardRejection)` and failure is recorded                                                                                                                        | `{ source_id, reason, raw_payload }`                                                                       | Increment `marketlens_ingestion_rejections_total{reason, source_id}`, log structured       |
| **`QualityFlagged`**           | `flag` sets a non-null `quality_flag` on a PriceObservation                                                                                                                            | `{ observation_id, product_id, establishment_id, source_id, quality_flag }`                                | Increment `marketlens_quality_flags_total{quality_flag, source_id}`, future: trigger alert |

## Relationships

- A **Product** has many **PriceObservation** (over time and across Establishments)
- An **Establishment** has many **PriceObservation** (over time and across Products)
- Each **PriceObservation** is uniquely identified by `(product_id, establishment_id, fetched_at)` and is versioned via SCD Type 2 (`valid_until`)
- Every **PriceObservation** belongs to exactly one **Product** and exactly one **Establishment**
- Every **PriceObservation** has a **Category** (via Product) and a **FiscalCode** (via Product)
- Every **Establishment** belongs to exactly one **Municipality**
- An **Establishment** may belong to zero-or-one **Chain** (nullable FK; chains are curated, so non-curated `cnpj_root`s yield `chain_id = null`)
- A **Chain** corresponds to exactly one `cnpj_root` (1:1)
- A **RawPriceObservation** is the input that produces zero-or-one **PriceObservation** and may resolve to or create one **Product**
- A **SefazAlPriceItem** maps 1:1 to a **RawPriceObservation** via `SefazAlAdapter.toRawObservation()`

## Example dialogue

> **Engineer:** "When SEFAZ returns 'REFRI COCA-COLA 350ML' from one CNPJ and 'COCA COLA 350 ML' from another, do we have one Product or two?"
> **Domain expert:** "One Product. Both have the same EAN once we strip leading zeros, so they unify under the same canonical SKU. We persist two PriceObservations — one per Establishment, both pointing at the same Product."

> **Engineer:** "What about a description like 'REFRI COCA COLA L 350 ML RESTAURANTE' with EAN null?"
> **Domain expert:** "That's a different Product — it's a restaurant serving, not a retail unit. The heuristic fallback (NCM + brand + gramature + 'RESTAURANTE' token) creates a distinct canonical SKU. The retail Coca-Cola price comparison stays clean."

> **Engineer:** "When a recruiter searches 'leite ninho' on the public API, do we hit SEFAZ?"
> **Domain expert:** "No. The public API queries our own database. We hit SEFAZ only via background ingestion jobs. Cache and ingestion are decoupled from user requests."

> **Engineer:** "If we add SEFAZ SP via web scraping later, does the Product table need a `source_id` column?"
> **Domain expert:** "No. Source is captured on RawPriceObservation, not on Product. Two sources can describe the same retail Coca-Cola — they unify into the same canonical Product. PriceObservation knows its origin via `source_id`, but Product is source-agnostic."

## Flagged ambiguities (resolved)

- "produto" was used for 3 distinct concepts during planning — resolved into **SefazAlPriceItem** (boundary), **RawPriceObservation** (canonical input), **Product** (canonical SKU).
- "snapshot" was an SCD-jargon-friendly but imprecise term for what we now call **PriceObservation** — "snapshot" implies complete state, but our row captures a single measurement. The DB table name `price_observations` reflects the precise term.
- "cesta básica" colliding with "cesta de compras" — resolved into **CuratedSeed** (internal seed list) vs **ShoppingBasket** (roadmap user feature).
- "categoria" used for both user-facing label and fiscal code — resolved into **Category** (GPC label) vs **FiscalCode** (NCM).
- "outlier" used for both hard rejection and soft flag — resolved into **HardRejection** (rejected pre-persistence) vs **QualityFlag** (post-persistence soft mark).
- "estabelecimento" was occasionally used for CNPJ root (8 digits, the company); resolved: **Establishment** is always the full 14-digit CNPJ (specific branch). The 8-digit root is captured as `cnpj_root` (generated column) and links to **Chain**.

## Naming policy

Codebase is in English by default. Portuguese is preserved only for irreducible Brazilian terms or proper nouns:

- **Kept in Portuguese**: `cnpj`, `cnpj_root`, `ncm`, `gpc`, `ibge_code`, `sefaz` (in source paths and type names like `SefazAlPriceItem`)
- **Translated to English**: `legal_name` (razão social), `trade_name` (nome fantasia), `street` (logradouro), `neighborhood` (bairro), `postal_code` (CEP), `sold_at` (data da venda), `declared_value` (valor declarado), `sale_value` (valor da venda), `source_canonical_description` (descricaoSefaz)
