---
adr: NNNN
status: Proposed
date: YYYY-MM-DD
deciders: [Lucas Almeida]
tags: []
supersedes: null
superseded-by: null
---

# Title — short, declarative, in the active voice

## Context and problem statement

What is the issue that motivates this decision? Describe the forces at play (technical, business, regulatory). Two to four sentences. Make explicit what would happen if we did nothing.

## Decision drivers

- Driver 1 (constraint, priority, non-functional requirement)
- Driver 2
- Driver 3

## Considered options

### Option 1: Name

One-paragraph description.

**Pros:** ...
**Cons:** ...

### Option 2: Name

One-paragraph description.

**Pros:** ...
**Cons:** ...

## Decision outcome

Chosen option: **"Option N"**, because ...

State the decision declaratively ("We will ..."). One to three sentences. Avoid hedging.

## Consequences

**Positive:**
- ...

**Negative:**
- ...

**Neutral:**
- ...

## Empirical evidence

If this decision was driven or validated by measurement, cite it (API calls made, datasets inspected, benchmarks, prototype findings). Quote numbers when available.

If principled rather than empirical: `N/A — principled architectural decision`.

## Validation criteria

When should we revisit this decision? Prefer a concrete trigger:
- **Metric:** name of the signal (e.g. `sefaz_observation_age_seconds`)
- **Threshold:** specific value that should prompt reopening
- **Cadence:** when we will check

If no quantitative trigger applies, state the qualitative one ("revisit if we add source #3", "revisit when team grows past N people").

## More information

- Related ADRs: ADR-NNNN
- Memory: `project_xxx.md`
- Glossary entries: `CONTEXT.md` § Section
- External references: <link>
