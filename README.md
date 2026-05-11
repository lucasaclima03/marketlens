# MarketLens

A multi-source price intelligence aggregator for retail prices in Brazil. The first source is the SEFAZ Alagoas Economiza Alagoas public API; the architecture supports additional sources via Anti-Corruption Layer per source.

> SEFAZ AL Manual v1.0 §4: "We advise that users who use our API for commercial purposes or with high access demand build their own intermediate infrastructure so as not to overload our network." MarketLens is that intermediate infrastructure.

## Status

M1 (skeleton) — the application boots, exposes `/health`, runs CI green. No domain logic yet.

See `docs/superpowers/specs/2026-05-11-skeleton-and-first-vertical-slice-design.md` for the design and `docs/adr/` for architectural decisions.

## Getting started

Prerequisites: Node 22 LTS, Docker.

```bash
nvm use                                          # uses Node 22 from .nvmrc
npm ci                                           # install deps
cp .env.example .env                             # edit SEFAZ_APP_TOKEN (any non-empty value works in M1)
docker compose -f docker-compose.dev.yml up -d   # Postgres + Redis
npm run db:migrate                               # no-op in M1 (no migrations yet)
npm run start:dev:api                            # API on http://localhost:3000
# in another terminal:
npm run start:dev:worker                         # Worker process
```

Verify:

```bash
curl http://localhost:3000/health
# → { "status": "ok", "info": { "postgres": { "status": "up" }, "redis": { "status": "up" } }, ... }
```

Bull Board UI: <http://localhost:3000/admin/queues>

> Note: `docker-compose.dev.yml` maps Redis to host port **6380** (container 6379) to coexist with other local Redis instances. `.env.example` matches.

## Development scripts

| Script                     | Purpose                                                  |
| -------------------------- | -------------------------------------------------------- |
| `npm run start:dev:api`    | API on hot-reload (node --watch + @swc-node/register)    |
| `npm run start:dev:worker` | Worker on hot-reload                                     |
| `npm run db:generate`      | Generate Drizzle migrations from `src/shared/db/schema/` |
| `npm run db:migrate`       | Apply pending migrations                                 |
| `npm run db:studio`        | Open Drizzle Studio UI                                   |
| `npm test`                 | Run Vitest suite                                         |
| `npm run test:coverage`    | Run with coverage report                                 |
| `npm run lint`             | ESLint flat config check                                 |
| `npm run format`           | Prettier write                                           |
| `npm run typecheck`        | `tsc --noEmit`                                           |
| `npm run build`            | Compile to `dist/`                                       |

## How to obtain a SEFAZ AppToken

Email `api@sefaz.al.gov.br` with your full name, CPF, and project description. Per the SEFAZ AL Manual v1.0, tokens are issued free of charge to registered developers.

## License

UNLICENSED (private repository while in MVP). Decision will be revisited when the project reaches a public-release milestone.
