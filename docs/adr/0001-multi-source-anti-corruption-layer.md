---
adr: 0001
status: Accepted
date: 2026-05-07
deciders: [Lucas Almeida]
tags: [ingestion, multi-source, architecture, domain]
supersedes: null
superseded-by: null
---

# Multi-source data architecture via Anti-Corruption Layer

## Context and problem statement

MarketLens aggregates retail price data and SEFAZ Alagoas is the first source, but other sources (other states' APIs, web scrapers, manual catalog imports) are expected to follow. Without a clear boundary, source-specific field names and shapes would leak into the normalization layer and the domain entities, forcing every new source to either duplicate normalization logic or trigger conditional branches inside shared services. Replaying historical raw data when normalization improves would also be impossible if we discard source-specific shapes at the boundary.

## Decision drivers

- Domain must remain source-agnostic — no `if (source === 'sefaz_al')` ladders inside `NormalizationService` or `Repository`
- New sources should be addable by writing one adapter + its tests, with no changes to normalizer, repository, or domain entities
- Tests for normalization should not depend on source-specific JSON fixtures
- Future capability: replay raw observations when normalization logic improves, without re-fetching from sources
- Naming hygiene: `Product`, `PriceObservation`, `Establishment` must never reference any specific source

## Considered options

### Option 1: Adapter per source producing a canonical `RawPriceObservation`

Each source has its own folder (`sources/sefaz-al/`) containing a typed client, a Zod boundary schema (`SefazAlPriceItem`), and an adapter (`SefazAlAdapter`) whose only job is to translate source-specific DTOs into the canonical internal type `RawPriceObservation`. Everything downstream (`Validator`, `NormalizationService`, `Repository`) consumes only the canonical type.

**Pros:**

- Domain entities never reference `sourceId` except via the `source_id` column on `PriceObservation`
- New source = new folder; existing code untouched
- Normalization tests use `RawPriceObservation` fixtures, fast and source-free
- Source-specific raw shapes can be archived for future replay

**Cons:**

- One extra type and one extra mapping function per source (~30–50 lines per source)
- Two places to update when a source adds a field we want to surface (boundary schema + adapter)

### Option 2: Map directly from `SefazAlPriceItem` to `Product` + `PriceObservation` in the SEFAZ adapter

Skip the canonical intermediate. The SEFAZ adapter produces domain entities directly.

**Pros:**

- Less code today (no `RawPriceObservation` type)

**Cons:**

- Adding a second source requires either duplicating normalization in the new adapter or introducing source conditionals inside the normalizer — the very coupling we want to avoid
- Domain entities accidentally inherit SEFAZ-specific assumptions (field cardinality, optional/required mix)
- Cannot replay raw data with improved normalization — the canonical shape is the only thing persisted

### Option 3: Skip the adapter layer entirely; treat `SefazAlPriceItem` as canonical

Make the SEFAZ DTO the project's canonical type.

**Pros:**

- Zero translation cost

**Cons:**

- Forecloses multi-source forever
- Bakes "SEFAZ" into domain naming throughout the codebase
- Reverses the project's stated multi-source intent

## Decision outcome

Chosen option: **Option 1 — adapter per source producing `RawPriceObservation`**, because it is the only option that satisfies the multi-source intent stated in `CONTEXT.md` without making future migrations a rewrite. The ~30–50 line per-source overhead is dwarfed by the cost of unwinding source coupling later.

## Consequences

**Positive:**

- Domain entities (`Product`, `PriceObservation`, `Establishment`) remain source-agnostic
- Adding a second source is mechanical: new folder, new schema, new adapter, new tests
- Normalization tests are fast and use clean `RawPriceObservation` fixtures
- Optional future capability: archive `RawPriceObservation` for replay without re-fetching

**Negative:**

- One extra type plus one mapping function per source
- Two-step lookup when debugging a field origin (DTO schema → adapter → domain)

**Neutral:**

- `sourceId` lives on `RawPriceObservation` and inside `sources/<source>/` only; it is captured on `PriceObservation.source_id` for audit, but not used in domain logic

## Empirical evidence

N/A — principled architectural decision. The choice is driven by stated multi-source intent and the cost asymmetry between adding the ACL upfront vs. retrofitting it later, not by measurement.

## Validation criteria

Revisit this decision if **any** of the following holds:

- We reach 3+ active sources and the per-source adapter overhead exceeds 200 lines on average (indicates a leaky canonical type that needs splitting)
- We discover that `RawPriceObservation` cannot represent a needed field from a new source without breaking adapters of existing sources (indicates the canonical type is too narrow)
- We never add a second source within 18 months of the first production deploy (indicates the multi-source intent was speculative; the ACL becomes pure overhead)

Cadence: revisit at every new source addition, and at the 12-month and 18-month marks post-deploy.

## More information

- Glossary: `CONTEXT.md` §§ "Sources & external boundary", "Domain entities (persisted)"
- Memory: `project_multi_source_intent.md` — confirms domain stays source-agnostic, SEFAZ AL is first of many
- Related folder convention: `src/sources/<source>/` (to be created when implementation begins)
