# Balu

A self-hostable, multi-tenant todo app with first-class iOS and Android apps.
**The self-hostable todo app that feels like Things and syncs like Todoist.**

## Run it

```sh
docker compose up --build
```

Open http://localhost:8080, register, done. One app container + Postgres — that's the
whole deployment. Configuration via env: `BALU_PORT`, `BALU_SECRET_KEY`,
`BALU_DB_PASSWORD`, `BALU_ALLOW_REGISTRATION`.

## Repo layout

| Path | What |
|---|---|
| `server/` | FastAPI backend: REST auth + sync engine, serves the built web client |
| `apps/web/` | React web client (Vite + TS) |
| `apps/mobile/` | Expo/React Native app (iOS + Android) |
| `packages/` | shared TS: `@balu/domain`, `@balu/nl-parser` (de+en), `@balu/sync-client`, `@balu/api-client` |
| `docs/` | plan, design language, API contract, research |

## Development

- Backend: `cd server && make dev` (needs the test/dev Postgres: `make db`)
- Web: `pnpm install && pnpm --filter @balu/web dev` (proxies `/api` → `:8000`)
- Mobile: `pnpm --filter @balu/mobile start` — see `apps/mobile/README.md`

## Docs

- [docs/PLAN.md](docs/PLAN.md) — product plan: positioning, feature blueprint, roadmap
- [docs/DESIGN.md](docs/DESIGN.md) — design language: color system, typography, motion, IA
- [docs/api/CONTRACT.md](docs/api/CONTRACT.md) — API + sync-protocol contract (source of truth)
- [docs/research/](docs/research/) — verified market research
