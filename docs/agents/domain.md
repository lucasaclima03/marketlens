# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This repo is **single-context**:

```
/
├── CONTEXT.md            ← domain glossary (boundary types, entities, terms to avoid)
├── docs/adr/             ← architectural decision records
│   └── 0001-multi-source-anti-corruption-layer.md
└── ...
```

There is no `CONTEXT-MAP.md` and no per-context `CONTEXT.md` files under `src/` — the entire codebase shares one domain language.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the canonical glossary. Defines boundary types (e.g. `SefazAlPriceItem`), domain entities (e.g. `Product`, `PriceObservation`, `Establishment`), and explicitly lists terms to avoid.
- **`docs/adr/`** — read the ADRs that touch the area you're about to work in. Each ADR has a YAML frontmatter — check `status` first. Only `Accepted` ADRs are binding; `Proposed` is a draft, `Superseded` points to its replacement via `superseded-by`, `Deprecated` and `Rejected` are kept for history but do not constrain new work.
- **`docs/adr/template.md`** — the canonical ADR shape. When writing a new ADR, copy this file as `NNNN-slug.md` and fill it in. Do not invent ad-hoc structures.

If you are about to introduce a new term that is not in `CONTEXT.md`, that is a signal: either you are inventing language the project does not use (reconsider) or there is a real gap (note it for `/grill-with-docs`).

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

Naming convention: identifiers are in English by default. Brazilian Portuguese is reserved for irreducible terms (`cnpj`, `ncm`, `gpc`, `ibge`) that do not have an English equivalent.

## Flag ADR conflicts

If your output contradicts an `Accepted` ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (multi-source ACL, Accepted 2026-05-07) — but worth reopening because…_

Never silently propose changes that invalidate prior decisions. Two paths:

1. **Extend the ADR** — propose appending to "More information" or to a follow-up ADR that references this one.
2. **Supersede it** — propose a new ADR whose `supersedes` field points at the old one; the old ADR's `status` flips to `Superseded` and its `superseded-by` field points at the new one.

When in doubt, surface the conflict and stop. The user decides whether to extend or supersede.
