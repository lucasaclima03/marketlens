---
adr: 0004
status: Accepted
date: 2026-05-11
deciders: [Lucas Almeida]
tags: [observability, infrastructure, monitoring, alerting]
supersedes: null
superseded-by: null
---

# Observability stack — PLG with Postgres-backed batch gauges

## Context and problem statement

ADR-0003 introduced four metrics — M1 (`curated_skus_without_recent_discovery_coverage`), M2 (`product_last_observation_age_hours` p95), M3 (`gpc_segments_without_seed_coverage`), M4 (`manual_seed_curation_time_hours_per_month`) — that exist as definitions but have no runtime implementation. `CONTEXT.md` § Domain events also commits the pipeline to emitting four counters (`PriceObservationCreated`, `PriceObservationExtended`, `IngestionRejected`, `QualityFlagged`) that today are only method invocations. Without an observability stack chosen, both the validation criteria of prior ADRs and the runtime instrumentation of the pipeline remain documentation, not running code.

A second concern: the nine alert classes the project needs (worker down, queue stalled, external dependency degraded, slow-burn domain regression, host saturation, etc.) have no rule engine and no delivery channel. A failure mode without an alert is a failure mode discovered late on a project without an on-call rotation.

If both questions stayed unanswered, the pipeline would ship blind, and each instrumentation decision would be made ad-hoc during implementation — producing inconsistent metric naming, label cardinality bombs, and unversioned dashboards that vanish on container restart.

## Decision drivers

- Single-developer project on a single-host deployment target with a constrained memory budget. Each additional container competes with the database, the worker, and the cache for resident memory.
- Cost must be marginal. Paid SaaS observability is only justified when it replaces at least one order of magnitude more operational effort than the self-hosted equivalent.
- Three heterogeneous signal types must coexist: runtime counters and histograms emitted by a long-lived worker (pull-friendly), gauges computed by short-lived batch jobs (pull-unfriendly), and structured JSON logs.
- Reproducibility is required: a third party cloning the repository must obtain the same dashboards, and container resets must not destroy tuning work.
- The decision must remain revisitable if host capacity becomes constrained, additional sources are added, or alerting patterns prove inadequate.

## Considered options

### Option 1: PLG (Prometheus + Loki + Grafana + Promtail) + node_exporter + Postgres-backed batch gauges

A self-hosted Prometheus + Loki + Grafana stack with Promtail shipping container stdout to Loki and `node_exporter` providing host-level metrics. The long-running worker exposes `/metrics` over HTTP for Prometheus to scrape on a fixed cadence. Batch jobs that compute M1–M4 do not push to a Pushgateway; instead they insert one row per execution into a Postgres table `observability_gauges`, which Grafana renders via its Postgres datasource. Grafana hosts a single user interface for dashboards and alerting, configured with three datasources (Prometheus, Loki, Postgres).

**Pros:**

- Open-source stack with broad ecosystem familiarity and portable query languages (PromQL, LogQL).
- The Pushgateway last-write-wins behavior is avoided entirely: a stale gauge surfaces as a missing row in `observability_gauges`, not as a silently-scraped outdated value.
- Postgres-backed gauges are transactional, durable, and naturally historized; the volume profile (tens of rows per day) is negligible against domain tables.
- Dashboards are versioned as JSON in the repository and loaded via Grafana provisioning at boot — they survive container resets and are reviewable via pull request.
- Cost is incremental disk and memory on the existing deployment host; no SaaS bill, no vendor lock-in.

**Cons:**

- Five additional containers (Prometheus, Loki, Grafana, Promtail, node_exporter) must be operated, including retention policies, upgrades, and disk monitoring.
- Two query dialects coexist in Grafana: PromQL for pipeline runtime counters, SQL for M1–M4 gauges. Mitigated by separating dashboards by intent and datasource.
- Dashboard discipline requires explicit export-and-commit after UI iteration; without it, modifications drift back to UI-only state and are lost on reset.

### Option 2: PLG + Pushgateway (canonical PLG with no Postgres deviation)

Identical to Option 1 except M1–M4 batch jobs push gauge values to a Pushgateway container that Prometheus scrapes.

**Pros:**

- Single observability paradigm: all metrics live in Prometheus, queried via PromQL only.
- Pushgateway is the documented Prometheus pattern for short-lived job metrics.

**Cons:**

- Pushgateway has no TTL: a batch job that silently stops running keeps serving its last pushed value indefinitely, masking the degradation it was meant to surface.
- Not durable: container crash erases pushed metrics until the next job execution.
- Adds a container for a small number of gauges; cost is disproportionate to value.
- Counter semantics must be implemented in the job itself, since Pushgateway is a passive key-value store.

### Option 3: Grafana Cloud free tier (managed metrics and logs)

The application emits Prometheus remote-write metrics and ships logs to a managed Grafana Cloud tenant. The free tier covers approximately 10 000 active series, 50 GB of logs per month, and 14-day retention.

**Pros:**

- Zero observability containers on the host.
- Same Grafana user interface, PromQL, and LogQL — the migration to or from self-hosted is a configuration change rather than a rewrite.
- Backups, retention enforcement, and upgrades are provider responsibilities.

**Cons:**

- External dependency: a provider outage removes the operational view of the system.
- Retention of 14 days is below the floor required by M2 (sustained 14-day evaluation) and M4 (trailing 3-month evaluation).
- Free-tier terms are provider-controlled and may change.
- Demo and audit access depend on a third-party tenant that readers and collaborators cannot replicate.

### Option 4: SigNoz self-hosted (OpenTelemetry-native all-in-one)

A single stack based on ClickHouse, ingesting metrics, logs, and traces via OpenTelemetry. Replaces Prometheus + Loki + Grafana with one product.

**Pros:**

- One mental model (OpenTelemetry end-to-end); future-proof if distributed tracing becomes a requirement.
- Modern user interface with better out-of-the-box experience than vanilla Grafana.
- Tracing is included, which would benefit cross-service latency debugging if the architecture grows.

**Cons:**

- ClickHouse alone has substantial memory requirements that conflict with the host's constrained budget.
- Community an order of magnitude smaller than the Prometheus/Grafana ecosystem; fewer reference materials and integrations.
- Push-style gauges from batch jobs require OpenTelemetry metrics with delta temporality — less documented and less idiomatic than the Prometheus equivalent.
- Tracing instrumentation imposes runtime overhead that yields no value for a single-worker batch pipeline.

### Option 5: Datadog or New Relic (managed commercial)

A single-agent commercial SaaS with premium UI, mature alerting, and on-call platform integrations.

**Pros:**

- Best-in-class developer experience.
- No operational responsibility for the observability infrastructure itself.

**Cons:**

- Recurring monthly cost scales with host count, custom metric series, and log volume.
- Vendor lock-in: proprietary dashboard format, alert format, and query languages.
- Disproportionate for a single-host, single-developer project with no real on-call rotation.
- Reader reproducibility is impossible without a paid tenant.

### Discarded: stdout-only with no centralized dashboards

Rejected because (a) M1–M4 from ADR-0003 require time-series rendering rather than line-by-line inspection, (b) the four pipeline counters need rate calculations that require a time-series database, (c) reproducibility of operational views cannot rest on shell scripts against ephemeral container logs.

### Discarded: ELK (Elasticsearch + Logstash + Kibana)

Rejected because Elasticsearch indexes log content (expensive and unnecessary for the expected volume profile) and the ecosystem requires two separate user interfaces (Kibana for logs, a separate metric tool) where Grafana already unifies metrics and logs via Loki.

## Decision outcome

Chosen option: **Option 1 — PLG (Prometheus + Loki + Grafana + Promtail) + node_exporter + Postgres-backed batch gauges**.

The following are fixed by this ADR:

**Stack composition.** Five observability containers run on the deployment host: Prometheus, Loki, Grafana, Promtail, node_exporter. The worker emits runtime metrics via `prom-client` on an HTTP `/metrics` endpoint, structured JSON logs via Pino to stdout, and batch-computed gauges via SQL `INSERT` into the `observability_gauges` table. Grafana is configured with three datasources: Prometheus, Loki, Postgres.

**Batch gauges live in Postgres, not Pushgateway.** Table:

```sql
CREATE TABLE observability_gauges (
  name        text NOT NULL,
  value       double precision NOT NULL,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (name, computed_at)
);
```

The M1–M4 jobs `INSERT` one row per execution. Grafana panels for M1–M4 query Postgres via SQL.

**Retention profile (balanced):**

| Datastore                       | Retention | Rationale                                                                                                |
| ------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| Prometheus                      | 30 days   | Covers M2 sustained 14-day evaluation with margin.                                                       |
| Loki                            | 14 days   | Matches the typical interactive debugging window and bounds the storage impact of any log-loop incident. |
| Postgres `observability_gauges` | 365 days  | Volume is negligible; preserves M4 trailing 3 months and the 90-day post-deploy revisit cadence.         |

**Alerting via Grafana Alerting, with nine initial rules.** All rules are committed as code under `infra/grafana/alerts/` and delivered to an informal webhook channel. Specific thresholds are calibrated post-deploy and documented in the operations runbook, not in this ADR.

| #   | Alert                                                            | Class               |
| --- | ---------------------------------------------------------------- | ------------------- |
| 1   | Worker process unreachable                                       | Process             |
| 2   | BullMQ queue stalled (waiting jobs grow while completions stall) | Pipeline            |
| 3   | External source (SEFAZ) failure rate elevated                    | External dependency |
| 4   | M2 sustained above threshold for 14 days                         | Domain (slow-burn)  |
| 5   | Filesystem free space below 10 %                                 | Host                |
| 6   | Database connection pool above 80 % capacity                     | Database            |
| 7   | Host memory available below 10 %                                 | Host                |
| 8   | Host swap usage above 50 %                                       | Host                |
| 9   | Host load-average above twice the CPU count                      | Host                |

**Naming convention for custom metrics.** Namespace `marketlens_`, snake_case, SI base units (`_seconds`, `_bytes`, `_total`). Four counters are fixed by contract (one per domain event in `CONTEXT.md`):

| Domain event               | Counter                                       | Labels             |
| -------------------------- | --------------------------------------------- | ------------------ |
| `PriceObservationCreated`  | `marketlens_price_observation_created_total`  | `source`           |
| `PriceObservationExtended` | `marketlens_price_observation_extended_total` | `source`           |
| `IngestionRejected`        | `marketlens_ingestion_rejected_total`         | `source`, `reason` |
| `QualityFlagged`           | `marketlens_quality_flagged_total`            | `flag`             |

The four Postgres gauges have fixed names in `observability_gauges.name`: `m1_curated_skus_uncovered`, `m2_p95_age_hours`, `m3_gpc_segments_without_seed_coverage`, `m4_curation_commits_30d`.

**Label cardinality rule.** Permitted labels are bounded enumerations: `source`, `reason`, `flag`, `endpoint`, `outcome`, `status` (HTTP class — `2xx`, `4xx`, `5xx`, never the exact code), `queue`. Prohibited as labels due to unbounded cardinality: `gtin`, `ean`, `cnpj`, `establishment_id`, `product_id`, `observation_id`, `query_text`, `description_token`, `error_message`. Enforcement is performed at code review; a new metric requiring an unlisted label triggers an amendment to this ADR.

**Dashboards committed as code via Grafana provisioning.** Iteration occurs in the user interface; once a dashboard stabilizes, it is exported (Share → Export JSON) and committed to `infra/grafana/dashboards/{folder}/{name}.json`. Provisioning loads the committed JSON at boot, and the repository is the source of truth. Folder structure mirrors intent:

```
infra/grafana/
├── provisioning/
│   ├── datasources/datasources.yaml
│   └── dashboards/dashboards.yaml
└── dashboards/
    ├── pipeline/    # PromQL — pipeline counters, latency
    ├── infra/       # PromQL — host, queue, database
    └── domain/      # SQL — M1–M4 gauges, slow-burn signals
```

## Consequences

**Positive:**

- A single user interface (Grafana) renders metrics, logs, and domain gauges with synchronized time axes; navigating from a counter anomaly to the corresponding log lines is a single click.
- The Pushgateway last-write-wins behavior is removed; absence of a recent row in `observability_gauges` surfaces a stalled batch job immediately.
- Postgres-backed gauges are transactional and historized for one year by default, which satisfies the trailing-window evaluations defined in ADR-0003 without additional retention engineering.
- Dashboards survive container resets via provisioning, and changes are reviewable via pull request.
- Both the metric and log query languages (PromQL, LogQL) are portable; migration to a managed provider or a different host is a configuration change rather than a rewrite.

**Negative:**

- Five additional containers consume incremental memory and disk on the deployment host. Retention policies, container upgrades, and disk capacity become operational concerns.
- Two query dialects coexist in Grafana panels. The mitigation is folder-level separation by datasource, which preserves coherence at the cost of mental switching between PromQL and SQL.
- Dashboard discipline depends on the export-and-commit workflow; lapses produce silent drift in operational views.
- The alert delivery channel is informal, with no guaranteed delivery semantics — adequate for the project's current operational expectations, not for production environments with hard service-level objectives.

**Neutral:**

- The reference in ADR-0003 § Validation criteria that mentioned Pushgateway by name is amended in the same pull request as this ADR to point at this document instead. The decision in ADR-0003 itself is not affected.
- `node_exporter` requires read access to the host's `/proc` and `/sys` paths. The mechanism is encoded in deployment configuration and documented in the operations runbook.
- Webhook credentials and other sensitive endpoints are managed by the deployment platform, not committed to the repository.
- Two ADR-0003 deferrals (promotion criteria from Discovery to `CuratedSeed`; lifecycle of fantasma SKUs) consume no observability budget today and are not affected by this decision.

## Empirical evidence

N/A — principled architectural decision. The choice rests on three known inputs: (a) the expected volume profile of a single-worker pipeline (tens of thousands of structured log lines per day, dozens of custom metric series), (b) the host's constrained memory budget, and (c) the documented conventions of the open-source observability ecosystem. Empirical evidence accumulates post-deploy and may activate the revisit triggers below.

## Validation criteria

Five concrete revisit triggers. Each is observable from the stack itself.

| Trigger                        | Signal                                                                                               | Threshold                              | Action                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Host saturation                | `node_memory_MemAvailable / node_memory_MemTotal` and `node_filesystem_avail / node_filesystem_size` | Either below 10 % sustained for 7 days | Migrate metrics and logs to a managed observability provider; preserve query languages.                                                       |
| Log volume blowup              | Loki ingestion rate                                                                                  | Above 5 GB/day sustained for 3 days    | Tighten Promtail filters or reduce Loki retention to 7 days; investigate the offending log path.                                              |
| Long-tail debugging demand     | Manual count of operator queries against logs older than 14 days                                     | At least 3 events in 6 months          | Raise Loki retention to 30 days.                                                                                                              |
| Curation overhead unmanageable | M4 sustained above 8 hours/month for 3 months **and** (M1 or M2 elevated)                            | Combined trigger per ADR-0003          | Reconsider the hybrid auto-suggester option deferred by ADR-0003. The observability stack itself is unaffected; this triggers a separate ADR. |
| Alert delivery unreliable      | Missed alert documented in an incident post-mortem                                                   | 1 event                                | Migrate from the current webhook channel to a self-hosted notification service; revisit channel choice in this ADR.                           |

Cadence: review at 90 days post-deploy regardless of triggers.

## More information

- Related ADRs:
  - ADR-0002 (fixed cron cadence) — defines the cadence at which pipeline counters are emitted.
  - ADR-0003 (Discovery via curated description+GPC sweeps) — defines M1–M4, whose storage and rendering this ADR formalizes. The § Validation criteria block of ADR-0003 referenced Pushgateway by name; that reference is amended in the same pull request as this ADR.
  - Future ADR — code quality gates may extend the label cardinality rule into automated linting.
  - Future ADR — backup and restore strategy will define which observability volumes are included or excluded.
- Memory: `project_adr_and_article_plan.md`, `project_pending_discussions.md`.
- Glossary: `CONTEXT.md` § Domain events (the four canonical counters) and § Quality (semantic anchors for `reason` and `flag` label values).
- External references:
  - Prometheus naming best practices: <https://prometheus.io/docs/practices/naming/>.
  - Grafana Loki: <https://grafana.com/docs/loki/latest/get-started/>.
  - Grafana provisioning: <https://grafana.com/docs/grafana/latest/administration/provisioning/>.
  - node_exporter: <https://github.com/prometheus/node_exporter>.
