# Balu

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/hero-dark.png">
  <img alt="Balu on an Android tablet, an iPad, an iPhone Duo, an iPhone and an Android phone" src="docs/screenshots/hero-light.png">
</picture>

A self-hostable, multi-tenant todo app with first-class iOS and Android apps.
**The self-hostable todo app that feels like Things and syncs like Todoist.**

- Offline-first everywhere: every client keeps a full local replica and a durable
  command queue - no spinners, airplane mode just works.
- Natural-language quick-add in German and English ("Wäsche waschen jeden zweiten
  Dienstag #Haushalt bis Freitag"), with live token highlighting -
  see [Quick-add syntax](#quick-add-syntax).
- Start dates and deadlines are separate things, like they should be.
- Workspaces, roles (incl. read-only viewers), invite links, task assignment,
  per-task comments.
- Notifications where self-hosters live: **ntfy, email, Telegram** - reminders,
  assignments, and comments reach you without app-store push relays.

| Light | Dark |
|---|---|
| ![Today, light](docs/screenshots/web-today-light.png) | ![Today, dark](docs/screenshots/web-today-dark.png) |

The same data, on the phone - the mobile apps are full clients, not a web view:

| Today | Today, dark | Task detail |
|---|---|---|
| ![iOS Today, light](docs/screenshots/ios-today-light.png) | ![iOS Today, dark](docs/screenshots/ios-today-dark.png) | ![iOS task detail](docs/screenshots/ios-detail.png) |

And on the big screens: iPad, the foldable iPhone Duo and Android tablets get a readable
column, a side rail on Android, and the task detail as a side sheet next to the list.

| iPad | iPhone Duo, unfolded | Android tablet |
|---|---|---|
| ![iPad, Today with the task detail side sheet](docs/screenshots/ipad-landscape.png) | ![iPhone Duo inner display, Today](docs/screenshots/duo-inner.png) | ![Android tablet, Today with the navigation rail and the task detail side sheet](docs/screenshots/android-tablet.png) |

Point them at your own server on first launch - there is no account with us.
[App Store](https://apps.apple.com/app/balu-private-todo-tasks/id6794310209) ·
[Google Play](https://play.google.com/store/apps/details?id=com.blaumedia.balutodo) ·
or build `apps/mobile/` yourself.

## Quick-add syntax

Type a sentence into quick-add and Balu picks out the parts it understands. Recognised
parts are highlighted while you type and removed from the title; everything else stays
the title. A plain date sets the **start date** (when the task shows up in Today), a
date with `by`/`due` (German: `bis`) sets the **deadline**. The parser follows the
app's language setting: German phrases only work with the app set to German, English
phrases with English. Examples below assume today is Wednesday, 11 June 2025.

**Dates and times**

| You type (English) | You type (German) | What it sets |
|---|---|---|
| `today`, `tomorrow` (`tmrw`) | `heute`, `morgen`, `übermorgen` | start date |
| `fri`, `friday` | `fr`, `freitag` | start = next such weekday, never today (`2025-06-13`) |
| `next monday`, `next week` | `nächsten Montag`, `nächste Woche` | start in next calendar week (`2025-06-16`) |
| `in 3 days`, `in 2 weeks` | `in 3 Tagen`, `in 2 Wochen` | start = today + N (`2025-06-14`, `2025-06-25`) |
| `24.12.`, `24.12.2026`, `2025-12-24` | same | start; without a year the next occurrence |
| `dec 24`, `24th dec` | - | start (English month names only) |
| `tonight` | `heute abend` | start today, flagged as evening |
| `by friday`, `due fri`, `by jun 20` | `bis Freitag`, `bis 20.6.` | **deadline** instead of start |
| `at 9`, `at 9am`, `at 5:30pm`, `17:30`, `at noon` | `um 9`, `9 Uhr`, `17:30`, `um 17.30 Uhr` | time of day = reminder (`09:00`, `17:30`) |
| `by 5pm`, `by noon` | `bis 17 Uhr` | reminder at that time and due that day; a date next to it (`by 5pm friday`) is the deadline |

A time without a date reminds you today, or tomorrow if it has already passed. A time
next to a date reminds on that day. A bare number is never a time (`Call 9` stays text).

**Recurrence**

| You type (English) | You type (German) | What it sets |
|---|---|---|
| `every monday` | `jeden Montag` | weekly on that weekday |
| `every other tuesday` | `jeden zweiten Dienstag` | every 2 weeks on that weekday |
| `every day`, `daily` | `jeden Tag`, `täglich` | daily |
| `every 3 days` | `alle 3 Tage` | every 3 days |
| `every week`, `weekly` | `jede Woche`, `wöchentlich` | weekly |
| `every 2 weeks` | `alle 2 Wochen` | every 2 weeks |
| `monthly`, `yearly` (`annually`) | `monatlich`, `jährlich` | monthly, yearly |

Typing a recurrence with a weekday and no date, `every monday at 9am`, puts the first
reminder on the next Monday.

**Projects, labels, priority**

| You type | What it sets |
|---|---|
| `#Home`, `#"Home renovation"` | project; use the quoted form for names with spaces |
| `@urgent @home` | labels, any number |
| `!p1`, `!p2`, `!p3`, `!!` | priority 1 to 3; `!!` is `!p1` |

`#project` and `@label` only match names that already exist (case-insensitive). An
unknown one stays in the title as typed. Inside a project, tasks go there by default;
an explicit `#project` wins. Quick-add has no syntax for sections or assignees: set
those on the task afterwards.

**Combined examples**

- `Wäsche waschen jeden zweiten Dienstag #Haushalt bis Freitag` - title "Wäsche waschen",
  every 2 weeks on Tuesday, project Haushalt, deadline `2025-06-13`.
- `Standup every monday at 9am @work` - weekly on Monday, reminder 09:00 on the next Monday.
- `Ship release by friday at 9am !p1 #Work` - deadline `2025-06-13`, reminder 09:00, priority 1.
- `Anruf bei Oma morgen um 17.30 Uhr` - start `2025-06-12`, reminder 17:30.
- `Pay rent monthly tomorrow` - start `2025-06-12`, repeats monthly.

**Good to know**

- Words are matched anywhere in the sentence, so a title word can be eaten: German `so`,
  `do`, `mi`, `di` are weekday abbreviations (`Das so machen` starts on Sunday), and
  English `sat`, `sun`, `mon`, `wed` are too. There is no escape character; the
  highlighting shows what was taken before you press Enter.
- One value per kind: if you type two start dates (`fri tmrw`), the last one wins and
  the other is dropped from the title as well.
- Weekday lists (`every mon, wed`) are not supported: `every mon, wed` repeats on Monday only and reads `wed` as a start date.
- Impossible values stay text: `31.02.`, `25:00`, `13pm`.
- Filler words stay in the title: `Arzt am Montag` becomes "Arzt am". Only `by`/`due`/`bis`
  are absorbed.
- English dates like `9 jul` win over a time (`at 9 jul` is 9 July, not 09:00).

## Run it

Releases are published as multi-arch images (`linux/amd64`, `linux/arm64`) - no
build step, no toolchain:

```sh
docker pull ghcr.io/blaumedia/balu-todo:latest
```

`:latest` follows the newest release; every release also gets an immutable `:X.Y.Z`
tag - pin that one in production. Put this in a `docker-compose.yml`:

```yaml
name: balu

services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: balu
      POSTGRES_PASSWORD: ${BALU_DB_PASSWORD:?set BALU_DB_PASSWORD in .env}
      POSTGRES_DB: balu
    volumes:
      - balu-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U balu -d balu"]
      interval: 3s
      timeout: 3s
      retries: 20
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  app:
    image: ghcr.io/blaumedia/balu-todo:latest
    env_file: .env
    environment:
      DATABASE_URL: postgresql+psycopg://balu:${BALU_DB_PASSWORD:?set BALU_DB_PASSWORD in .env}@db:5432/balu
      SECRET_KEY: ${BALU_SECRET_KEY:?set BALU_SECRET_KEY in .env}
    volumes:
      - balu-data:/data
    ports:
      - "${BALU_PORT:-8080}:8000"
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  balu-db:
  balu-data:
```

and next to it a `.env` with the two required secrets:

```sh
printf 'BALU_SECRET_KEY=%s\nBALU_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 16)" > .env
docker compose up -d
```

Open http://localhost:8080, register, done. One app container + Postgres - that's the
whole deployment; the schema migrates itself on startup. Configuration via env:
`BALU_PORT`, `BALU_SECRET_KEY`, `BALU_DB_PASSWORD`, `BALU_ALLOW_REGISTRATION`,
`BALU_CORS_ORIGINS`, `BALU_MCP_ENABLED`, plus the optional notification transports - the
full list with comments is [`.env.example`](.env.example), and every one of them reaches
the container through `env_file`. Upgrading is `docker compose pull && docker compose up -d`.

**Rolling back** to an older image is safe only if the newer release's migrations are
undone first, otherwise the older image cannot boot ("Can't locate revision"; the
error names the revision to use). In order:

1. With the NEW container still running: `docker compose exec app python -m balu.migrate
   downgrade <revision>`, where `<revision>` is the revision the release notes name
   (for the release that added `f6a7b8c9d0e1`: `e5f6a7b8c9d0`). The command prints the
   current and the target revision and refuses, without `--yes`, any target other than
   the image's head or its previous head (`base`, `-2`, a typo, an abbreviated id; `-1`
   counts from the database's current revision, so it passes only while the database is
   at the image's head): those walks can drop tables such as `attachments`.
2. Pin the older image tag in `docker-compose.yml`, then `docker compose pull` and
   `docker compose up -d`.

Do not restart the new container between 1 and 2: with `restart: unless-stopped` it
migrates straight back to head. Do not use `BALU_AUTO_MIGRATE=0` for this: it leaves the
newer revision stamped in the database.

**Orphan attachment blobs.** A crash between a delete's commit and the file removal can
leave bytes nothing points at. That is harmless disk usage and no routine job is needed;
nothing sweeps automatically (an automatic sweep would wipe every blob on an empty or
mismatched database). To reclaim the space, run
`docker compose exec app python -m balu.blobs sweep`: a dry run printing counts and total bytes. `--apply` moves
files older than 1 h with no live attachment row into `attachments/.orphans/<timestamp>/`
instead of deleting them (`docker compose exec app python -m balu.blobs sweep --apply`),
and refuses when the attachments table has no live rows or when
more than 50% of the candidate files are orphans (`--force` overrides). After checking
that nothing is missing, `docker compose exec app python -m balu.blobs sweep
--purge-quarantine --older-than-days N` deletes quarantined batches older than N days.

`BALU_SECRET_KEY` and `BALU_DB_PASSWORD` have **no defaults** - compose refuses to
start without them, and the server refuses to boot on a weak (<32 char) or
placeholder signing key. For a throwaway local run you can set `BALU_DEV=1` to
bypass the key check.

`BALU_DB_PASSWORD` is inserted into `DATABASE_URL` as is (and passed unchanged to
Postgres), so it must stay URL-safe: no URL-reserved characters (`@ / : ? # %`); the
generated hex value is safe. Percent-encoding (`@` as `%40`) applies only to a
hand-written `DATABASE_URL`, where Postgres was given the decoded password: the only
unencoded `@` may be the one before the host, and the server (and every migration
run) refuses to start when the URL has another one, or one after a `/`, `?` or `#`
(the error does not print the URL).

The refresh-token reuse window (60 s, CONTRACT section 1) keeps the successor token in
the memory of one server process; the image runs a single uvicorn worker. With several
workers, or after a restart, a retried refresh is treated as a replay and the user logs
in again - safe, only less friendly.

### Build it yourself instead

The compose file in this repo builds from source rather than pulling. Requires
Docker Compose **2.24+** (the `env_file` long syntax):

```sh
git clone https://github.com/blaumedia/balu-todo && cd balu-todo
cp .env.example .env
printf 'BALU_SECRET_KEY=%s\nBALU_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 16)" >> .env
docker compose up --build
```

### Production notes

- Set a real `BALU_SECRET_KEY` (e.g. `openssl rand -hex 32`) and `BALU_DB_PASSWORD`.
- CORS is same-origin by default. Only set `BALU_CORS_ORIGINS` if you serve the web
  client from a different origin than the API.
- Put a TLS-terminating reverse proxy (Caddy/Traefik/nginx) in front, and set
  `BALU_ALLOW_REGISTRATION=false` once **everyone who needs an account has one**.
  Read that literally: registration is the only way an account is created. A
  workspace invite adds an *existing* user to a workspace - `POST /invites/accept`
  authenticates first - so it cannot get a new person onto a closed server. To add
  someone later, flip the setting back to `true` while they sign up, then close it
  again.
- Notification transports are optional: `BALU_SMTP_HOST/PORT/USER/PASSWORD/FROM`
  enable email, `BALU_TELEGRAM_BOT_TOKEN` enables Telegram; ntfy needs nothing.
- Back up **both** volumes: `balu-db` holds everything except attachment files,
  and `balu-data` holds those files. They are not in the database dump, so a
  database-only backup restores every task with its attachments listed and none
  of them downloadable. `BALU_MAX_ATTACHMENT_MB` (default 25) caps each upload.
- Behind a reverse proxy, set `BALU_TRUSTED_PROXY_HOPS` to the number of proxies
  in front of Balu (usually `1`) so rate limiting keys on the real client address
  from `X-Forwarded-For`. Leave it at `0` when Balu is exposed directly -
  otherwise anyone can spoof that header and sidestep the limiter. The value is
  counted from the right, because proxies *append*, so it has to match your
  actual chain depth.
- Changing `BALU_DB_PASSWORD` after the first run does **not** re-key the database:
  Postgres only applies it when initialising an empty volume. Rotate the role
  instead - `docker compose exec db psql -U balu -d balu -c "ALTER USER balu WITH
  PASSWORD '…';"` - or start from a fresh volume.

## Claude Code (MCP)

Balu can act as a remote MCP server, so Claude Code manages your tasks directly:
"what's due this week", "file these three under Haushalt with a deadline of Friday".
It is **off by default** - turn it on per deployment:

```sh
BALU_MCP_ENABLED=true
```

Then open **Settings → Claude / MCP** in the web or mobile app and hit **Generate key**.
Nothing is minted until you ask for it; afterwards the screen shows the endpoint, the
key, and the ready-made command:

```sh
claude mcp add --transport http balu https://balu.example.com/api/v1/mcp \
  --header "Authorization: Bearer balu_mcp_…"
```

The key is a bearer token with full access to that account's workspaces and it does not
expire - treat it like a password, and use **Generate a new key** in settings if it ever
leaks (every client using the old one loses access immediately). Read-only viewers stay
read-only over MCP too, and anything Claude changes syncs to web and mobile like any
other client. Tools: `list_workspaces`, `list_projects`, `list_tasks`, `get_task`,
`create_task`, `update_task`, `complete_task`, `reopen_task`, `delete_task`, `add_comment`.

## Repo layout

| Path | What |
|---|---|
| `server/` | FastAPI backend: REST auth + sync engine, serves the built web client |
| `apps/web/` | React web client (Vite + TS) |
| `apps/mobile/` | Expo/React Native app (iOS + Android) |
| `packages/` | shared TS: `@balu/domain`, `@balu/nl-parser` (de+en), `@balu/sync-client`, `@balu/api-client` |
| `docs/` | API + sync contract, screenshots |

## Development

- Backend: `cd server && make dev` needs a Postgres at `DATABASE_URL` (default `postgresql+psycopg://balu:balu@localhost:5432/balu`) and either a real `SECRET_KEY` or `BALU_DEV=1`. The quickest throwaway database is the test one: `make test-db-up`, then `DATABASE_URL=postgresql+psycopg://balu:balu@localhost:5433/balu_test BALU_DEV=1 make dev` (port = your `TEST_DB_PORT`; tmpfs: gone after `make test-db-down`, and shared with `make test`).
- Web: `pnpm install && pnpm --filter @balu/web dev` (proxies `/api` → `:8000`)
- Mobile: `pnpm --filter @balu/mobile start` - see `apps/mobile/README.md`
- Lint: `pnpm lint` (ESLint 9 in every JS/TS package; CI runs it).
- Several checkouts or git worktrees: each additional one needs its own `COMPOSE_PROJECT_NAME` and `BALU_PORT` in its `.env` (see `.env.example`), and for server tests `make test TEST_DB_PORT=5434` (or export `BALU_TEST_DB_PORT`). If `make test` stops on a legacy `balu-test-db` container left by an older checkout, stop it only if no older checkout still uses it, otherwise use `TEST_DB_PORT=5434`.
- E2E helpers (API, web, Android emulator): [`tools/e2e/README.md`](tools/e2e/README.md).

## Ideas

Things that might land later. No dates attached - this is a self-hosted project, and
the order will follow what people actually run into.

- **Shared-group mechanics** - fair rotation for recurring chores (round-robin /
  least-busy) and opt-in group points, for households sharing a workspace.
- **Kanban and calendar views** alongside the existing lists.
- **Grocery-mode lists** with aisle auto-grouping.
- **Capture polish** - share-sheet and intent capture on mobile, natural-language
  completion inside the date picker.

Explicit non-goals: no Gantt charts, no time tracking, no docs-and-notes platform.
Feature restraint is deliberate - capture friction is what makes a todo app stop
getting used, and every added surface is a chance to introduce some. There are also
no paid tiers to design around; self-hosted means everything is on.

## Docs

- [docs/api/CONTRACT.md](docs/api/CONTRACT.md) - API + sync-protocol contract (source of
  truth; start here to write your own client)

## License

[MIT](LICENSE)
