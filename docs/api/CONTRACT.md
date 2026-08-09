# Balu API contract v1

The single source of truth for server ↔ client communication. Server (FastAPI) and all
clients (web, mobile) implement exactly this. Changes to this file are breaking-change
reviews, not drive-by edits.

Design in one paragraph: **REST is only for identity** (auth, account, workspace
membership). **Everything inside a workspace flows through one sync endpoint** — a
Todoist-style server-authoritative command queue with `sync_token` incremental pulls.
Clients keep a full local replica, apply mutations optimistically, queue commands durably,
and flush when online. The server is the authority; conflicts resolve by
last-write-wins at the patch level (see §6).

- Base URL: `/api/v1`
- All request/response bodies: JSON, UTF-8.
- Timestamps: ISO 8601 UTC with `Z` suffix (`2026-07-23T14:00:00Z`). Server-assigned.
- Calendar dates (`start_date`, `deadline`): `YYYY-MM-DD`, no timezone — they mean "that
  day in the user's local calendar".
- IDs: UUIDv4 strings, server-generated. Clients reference not-yet-synced objects via
  `temp_id` (§5.3).
- Errors (REST): `{"detail": {"code": "<machine_code>", "message": "<human text>"}}` with
  appropriate HTTP status. Codes used: `invalid_credentials`, `email_taken`,
  `registration_disabled`, `invalid_token`, `token_expired`, `not_found`, `forbidden`,
  `validation_error`, `rate_limited`, `last_owner`, `channel_unavailable`.
  Error messages are for humans and never carry internal detail (driver messages,
  the submitted body, transport hostnames) — that goes to the server log.

## 1. Authentication

JWT bearer auth. `Authorization: Bearer <access_token>` on every authenticated request.

- **Access token**: JWT, 30 min expiry. Claims: `sub` (user id), `exp`, `iat`, `type: "access"`.
- **Refresh token**: opaque random string (256 bit), stored hashed server-side, **rotated
  on every use** (old one invalidated), 60 day expiry. One row per device/session.

| Endpoint | Body | Response |
|---|---|---|
| `POST /auth/register` | `{email, password, name}` | `201 {user, access_token, refresh_token}` |
| `POST /auth/login` | `{email, password}` | `200 {user, access_token, refresh_token}` |
| `POST /auth/refresh` | `{refresh_token}` | `200 {access_token, refresh_token}` |
| `POST /auth/logout` | `{refresh_token}` | `204` (invalidates the whole session family) |

Rules:

- Registration is gated by env `BALU_ALLOW_REGISTRATION` (default `true`). When disabled
  → `403 registration_disabled`. **Invites do not bypass this gate**: `POST /invites/accept`
  resolves an authenticated user, so it can only add an account that already exists. With
  registration closed there is no route to a new account at all.
- `POST /auth/register` auto-creates a personal workspace named after the user — the
  full name, e.g. "Anna Maria Schmidt" — with the user as `owner`.
- **Throttling (v1.2.1):** `/auth/login`, `/auth/register` and `/auth/refresh` are rate
  limited per client IP, and `/auth/login` additionally per account. Exceeding a limit →
  `429 rate_limited`. A login for an unknown address costs the same as one for a known
  address (no enumeration oracle).
- `POST /auth/logout` revokes the entire refresh-token family, not only the presented
  token — otherwise earlier tokens of the same session stayed usable after logout.
- Password: min 8 chars, hashed with argon2id (fallback bcrypt acceptable if argon2 is a
  packaging problem — pick one, document it).
- `POST /auth/refresh` with an already-rotated token → `401 invalid_token` **and**
  invalidates the whole session family (replay defense).

## 2. Account & workspaces (REST)

| Endpoint | Response / notes |
|---|---|
| `GET /me` | `{user, memberships: [{workspace, role}]}` — the client's boot call |
| `PATCH /me` | body: any of `{name, locale ("de"\|"en"), theme ("system"\|"light"\|"dark")}` |
| `POST /workspaces` | `{name}` → `201 {workspace}`; creator becomes `owner` |
| `PATCH /workspaces/{id}` | `{name}` — requires role ≥ admin |
| `DELETE /workspaces/{id}` | requires `owner`; hard-deletes workspace + contents → `204` |
| `GET /healthz` | `200 {"status":"ok"}` — no auth, for compose healthchecks |

Object shapes:

```json
// user
{"id": "…", "email": "…", "name": "Dennis", "locale": "de", "theme": "system",
 "created_at": "…"}

// workspace
{"id": "…", "name": "Dennis", "created_at": "…"}

// membership role: "owner" | "admin" | "member" | "viewer"
```

`viewer` is read-only: sync pulls work, every command fails with `forbidden` (§5.4).

## 3. Data model (workspace-scoped, synced)

All five resource types below travel through the sync endpoint. Common envelope fields on
every synced object: `id`, `workspace_id`, `created_at`, `updated_at`, `is_deleted`
(soft-delete flag — deleted objects still appear in incremental syncs so clients can
remove them locally).

### 3.1 `project`

```json
{"id": "…", "workspace_id": "…", "name": "Finanzen", "color": "blue",
 "sort_order": 1000, "archived_at": null,
 "created_at": "…", "updated_at": "…", "is_deleted": false}
```

`color`: one of `slate|red|orange|amber|green|teal|cyan|blue|indigo|violet|pink|rose`.
There is **no Inbox project** — Inbox is `task.project_id == null`.

### 3.2 `section` (headings inside a project)

```json
{"id": "…", "workspace_id": "…", "project_id": "…", "name": "Q3",
 "sort_order": 1000, "created_at": "…", "updated_at": "…", "is_deleted": false}
```

### 3.3 `task`

```json
{"id": "…", "workspace_id": "…",
 "project_id": null, "section_id": null, "parent_task_id": null,
 "title": "Steuererklärung abgeben", "notes": "",
 "start_date": "2026-07-24", "evening": false, "someday": false,
 "deadline": "2026-07-31", "reminder_at": null,
 "recurrence": null,
 "priority": 1,
 "label_ids": ["…"],
 "assigned_to": null,
 "sort_order": 2000,
 "completed_at": null, "completed_by": null,
 "created_by": "…", "created_at": "…", "updated_at": "…", "is_deleted": false}
```

Field semantics (these ARE the product decisions — implement precisely):

- **`start_date` vs `deadline` are independent.** `start_date` = when the task becomes
  current (drives Today). `deadline` = hard due date (drives overdue). Either, both, or
  neither may be set.
- `evening`: only meaningful when the task appears in Today; renders in the
  "This Evening" section.
- `someday: true` ⟹ server forces `start_date = null` (mutually exclusive).
- `reminder_at`: UTC datetime; drives push later. No validation coupling to dates in v1.
- `recurrence`: RRULE subset string or null: `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`
  `[;INTERVAL=n][;BYDAY=MO,TU,WE,TH,FR,SA,SU]` (BYDAY only with WEEKLY).
  Examples: `FREQ=DAILY`, `FREQ=WEEKLY;INTERVAL=2;BYDAY=TU`.
- `priority`: `0` none, `1` = P1 (highest), `2` = P2, `3` = P3.
- `sort_order`: integer ordering **within its container** (container = parent task if
  `parent_task_id` set, else (project, section) pair, else Inbox). Clients append with
  `max + 1000`; reorders rewrite the affected set (§5.5 `task_reorder`).
- Subtasks: one level only in v1 — server rejects a `parent_task_id` pointing at a task
  that itself has a parent (`invalid_args`).
- `label_ids` order is not meaningful.
- `assigned_to` must be a member of the workspace.

**Completing a recurring task** (part of `task_complete`): instead of setting
`completed_at`, advance the schedule and leave the task open. (Completion history for
recurring tasks is a v2 concern.) `task_complete` on a non-recurring task sets
`completed_at`/`completed_by`.

The next occurrence is **anchored**, not derived from the completion date — the series is
`anchor, anchor + INTERVAL, anchor + 2·INTERVAL, …` (for `FREQ=WEEKLY` with `BYDAY`: the
BYDAY days of every `INTERVAL`-th week starting from the anchor's own week), and the
answer is its smallest member strictly greater than `after`. Each step is measured from
the anchor, so a clamped month-end recovers: Jan 31 → Feb 28 → **Mar 31**.

| Task has | anchor | after | effect |
|---|---|---|---|
| `start_date` | `start_date` | `max(start_date, today)` | `start_date` = next occurrence; `deadline` shifts by the same delta |
| only `deadline` | `deadline` | `max(deadline, today)` | `deadline` = next occurrence |
| neither | `today` | `today` | `start_date` = next occurrence |

`today` comes from the **client**: `task_complete` carries `args.today` (`YYYY-MM-DD`),
the device's local calendar day, because the optimistic apply runs against that day (§0).
The server clamps it to ±1 day of UTC — the real span of world timezones — and falls back
to its own UTC day when it is absent or outside that range. Deriving it from UTC alone
made the server disagree with any client more than a few hours out, and the completed task
visibly jumped once the response landed. Server
and client run the same algorithm — `server/balu/sync/recurrence.py` and
`packages/sync-client/src/recurrence.ts` share a test-vector table, because a mismatch
makes a completed task visibly jump once the sync response lands.

### 3.4 `comment` — v1.2

Per-task comment threads, synced like every other resource.

```json
{"id": "…", "workspace_id": "…", "task_id": "…", "author_id": "…",
 "body": "Ist erledigt, war aber knapp.",
 "created_at": "…", "updated_at": "…", "is_deleted": false}
```

- `body`: plain text, 1–5000 chars (client may render minimal markdown later).
- Ordering: `created_at` ascending within a task.
- Deleting a task soft-deletes its comments (cascade, versions bumped).
- Roles: `viewer` reads but cannot write; `member`+ can comment; edit/delete only by
  the author (admins may delete).

### 3.5 `label`

```json
{"id": "…", "workspace_id": "…", "name": "privat", "color": "amber",
 "sort_order": 1000, "created_at": "…", "updated_at": "…", "is_deleted": false}
```

Label names unique per workspace case-insensitively (`label_add` with an existing name →
error `name_taken`).

### 3.6 `member` (read-only via sync; managed via REST + invites §7)

```json
{"id": "<user_id>", "workspace_id": "…", "name": "Dennis", "email": "…",
 "role": "owner", "created_at": "…", "updated_at": "…", "is_deleted": false}
```

## 4. Smart-list predicates (shared client/server logic)

Defined here so every client and the server agree exactly. `open` means
`completed_at == null && !is_deleted`. "today" = client-local calendar date.

| List | Predicate | Ordering |
|---|---|---|
| **Inbox** | open ∧ `project_id == null` ∧ `!someday` ∧ `parent_task_id == null` | `sort_order` |
| **Today** | open ∧ `!someday` ∧ (`start_date ≤ today` ∨ `deadline ≤ today`) | overdue-deadline first, then `evening` last, then priority (1<2<3<0), then `sort_order` |
| **Upcoming** | open ∧ (`start_date > today` ∨ `deadline > today`) — grouped by the earlier of the two dates | date, then `sort_order` |
| **Anytime** | open ∧ `!someday` ∧ `start_date == null` ∧ `project_id != null` | project order, then `sort_order` |
| **Someday** | open ∧ `someday` | `sort_order` |
| **Logbook** | `completed_at != null` ∧ `!is_deleted` | `completed_at` desc, grouped by day |
| **Assigned to me** (v1.2) | open ∧ `assigned_to == <current user>` | deadline asc (nulls last), then priority, then `sort_order` |

Clients show "Assigned to me" only when the workspace has more than one member.

Subtasks never appear in smart lists independently in v1 (only under their parent).
The Today view additionally splits into "Today" and "This Evening" via `evening`.

## 5. Sync endpoint

`POST /api/v1/workspaces/{workspace_id}/sync` — auth required, membership required.
Read and write in one round trip: commands are applied first, then changes (including the
effects of those commands) are returned.

### 5.1 Request

```json
{
  "sync_token": "*",
  "commands": [
    {"type": "task_add", "uuid": "9f1e…", "temp_id": "tmp-a",
     "args": {"title": "Buy milk", "project_id": null, "start_date": "2026-07-23"}},
    {"type": "task_complete", "uuid": "8c2d…", "args": {"id": "…"}}
  ]
}
```

- `sync_token`: `"*"` requests a **full sync**; otherwise the opaque token from the last
  response. Unknown/stale tokens (server may GC old history) → server responds with a
  full sync (`full_sync: true`) rather than erroring.
- `commands` (optional, max 100 per request): applied **in order, each in its own
  transaction**. One failing command does not abort the rest.
- `uuid`: client-generated UUIDv4, the **idempotency key**, scoped to `(workspace, uuid)`.
  The server persists processed uuids per workspace; a replayed uuid **in the same
  workspace** is not re-applied and returns its stored status. The same uuid in another
  workspace is a different command and is applied normally.

### 5.2 Response

```json
{
  "sync_token": "djEyMzQ1",
  "full_sync": false,
  "sync_status": {"9f1e…": "ok", "8c2d…": {"error_code": "not_found", "error": "…"}},
  "temp_id_mapping": {"tmp-a": "3d0f…"},
  "projects": [...], "sections": [...], "tasks": [...], "labels": [...],
  "comments": [...], "members": [...]
}
```

- Resource arrays contain **only objects changed since `sync_token`** (full objects, not
  diffs; soft-deleted ones included with `is_deleted: true`). On full sync, deleted
  objects are omitted.
- Implementation note (server): per-workspace monotonic `version` bigint; every mutation
  bumps it and stamps the row; `sync_token` encodes the version. Any encoding is fine —
  clients treat it as opaque.

### 5.3 `temp_id`

`*_add` commands carry a client-chosen `temp_id`. Later commands **in the same or later
requests** may reference the object by `temp_id` anywhere an id is expected (e.g.
`task_add` with `"project_id": "tmp-a"`). The server resolves known temp_ids
(mapping persisted with the command log) and returns `temp_id_mapping` for all newly
created objects.

### 5.4 Command catalog

Args marked `?` optional. Patch semantics: `*_update` applies **only the keys present**
in `args` (absent ≠ null; sending `"deadline": null` clears it, omitting leaves it).

| Command | Args |
|---|---|
| `project_add` | `temp_id`, `name`, `color?`, `sort_order?` |
| `project_update` | `id`, then any of `name, color, sort_order, archived_at` |
| `project_delete` | `id` — soft-deletes project + its sections + its tasks + those tasks' comments |
| `section_add` | `temp_id`, `project_id`, `name`, `sort_order?` |
| `section_update` | `id`, any of `name, sort_order` |
| `section_delete` | `id` — its tasks move to the project body (section_id → null) |
| `task_add` | `temp_id`, `title`, plus any writable task field. A `section_id` must belong to the task's own project. |
| `task_update` | `id`, any of `title, notes, start_date, evening, someday, deadline, reminder_at, recurrence, priority, label_ids, assigned_to` |
| `task_move` | `id`, `project_id?`, `section_id?`, `parent_task_id?`, `sort_order?` — container change. A `section_id` must belong to the task's own project (`invalid_args` otherwise); changing `project_id` without naming a `section_id` clears the section. |
| `task_complete` | `id`; optional `today` (`YYYY-MM-DD`) — see §3.3 for recurring behavior |
| `task_uncomplete` | `id` |
| `task_delete` | `id` — soft-deletes task + its subtasks + all their comments |
| `task_reorder` | `items: [{"id": …, "sort_order": …}, …]` — bulk, single container expected |
| `label_add` | `temp_id`, `name`, `color?` |
| `label_update` | `id`, any of `name, color, sort_order` |
| `label_delete` | `id` — removed from all tasks |
| `comment_add` (v1.2) | `temp_id`, `task_id`, `body` |
| `comment_update` (v1.2) | `id`, `body` — author only |
| `comment_delete` (v1.2) | `id` — author or admin+ |

Per-command error codes in `sync_status`: `invalid_args` (validation), `not_found`
(id/temp_id unknown or deleted), `forbidden` (viewer role; or comment edit/delete by
a non-author non-admin), `name_taken` (labels).

Text limits (`invalid_args` beyond them): task `title` ≤ 1000, task `notes` ≤ 20000,
comment `body` ≤ 5000, project/section/label `name` ≤ 200, `recurrence` ≤ 200.

**Clients must roll back a rejected command.** A non-`ok` `sync_status` means the
optimistic mutation never happened server-side; leaving it in the local replica leaves
the user looking at an object that does not exist (and it survives restarts, because the
replica is persisted). `@balu/sync-client` discards the replica and forces a full sync
whenever any command in a flush was rejected, then reports the failures to the app.

### 5.5 Conflict policy (documented behavior, tested)

- Two clients patch different fields of one task → both patches survive (patch = only
  sent keys).
- Two clients patch the same field → **last write wins** (server apply order).
- Update/move/complete on a deleted object → `not_found`; the client drops the queued
  command and reconciles from the pull.
- Concurrent `task_move` + `task_complete` → both apply (orthogonal fields).
- Reorder races: `task_reorder` is bulk LWW; a stale reorder may interleave orders —
  acceptable, next reorder heals it. No exotic merging in v1.

## 6. Client obligations (what `@balu/sync-client` implements)

1. Full local replica per workspace; **every** read renders from the replica.
2. Mutations: apply optimistically to the replica → append command to a **durable**
   queue (localStorage/SQLite) with a fresh uuid → flush queue (batches ≤ 100, in order)
   whenever online.
3. Never blocks UI on network. Sync state surfaced as: `synced | syncing | offline |
   error` for the ambient indicator.
4. On `sync_status` error for a command: drop it, log it, trust the server pull
   (the replica self-heals because the response includes current object states).
5. On `full_sync: true`: replace replica wholesale.
6. temp_id bookkeeping: after flush, rewrite queued commands and replica ids via
   `temp_id_mapping`.
7. Poll cadence v1: pull on app focus + after every flush + every 60 s while visible.
   (WebSocket/SSE push is a later optimization; the protocol doesn't change.)

## 7. Invites & member management (REST) — v1.1

Sharing UI surface. All routes require auth; role requirements noted per route.
Invites expire after 14 days.

| Endpoint | Notes |
|---|---|
| `POST /workspaces/{id}/invites` | body `{role: "admin"\|"member"\|"viewer", email?}` → `201 {invite}`; requires role ≥ admin. No mail is sent (the client shows/copies the link `/invite/<token>`), but when `email` is set the invite is **bound** to it — see accept. |
| `GET /workspaces/{id}/invites` | `{invites: [...]}`, pending only; role ≥ admin |
| `DELETE /workspaces/{id}/invites/{invite_id}` | revoke → `204`; role ≥ admin |
| `POST /invites/accept` | body `{token}` → `200 {workspace}`; adds the authed user with the invite's role; already-a-member → `200` idempotently; expired/revoked/unknown → `400 invalid_token`. If the invite carries an `email`, only the user with that address may accept (case-insensitive); anyone else → `400 invalid_token`. |
| `PATCH /workspaces/{id}/members/{user_id}` | body `{role}`; role ≥ admin, subject to the rank rules below; demoting the **last owner** → `400 last_owner` |
| `DELETE /workspaces/{id}/members/{user_id}` | remove member (or yourself = leave); role ≥ admin or self, subject to the rank rules below; last owner → `400 last_owner`. Removed members surface via sync as `member` with `is_deleted: true`. |

**Rank rules (v1.2.1).** Roles rank `viewer < member < admin < owner`.

- You may not act on a member ranked **above** you → `403 forbidden`. (Without this an
  admin could demote a sitting owner.) **Peers may act on each other**: an admin can
  demote or remove another admin, and an owner another owner. Forbidding peer actions
  made a co-owner unremovable through the API — only they could step down — which is a
  worse failure than lateral admin conflict, and an owner can always undo one.
- Granting or revoking the `owner` role requires role `owner`. An admin setting
  `{"role": "owner"}` → `403 forbidden`.
- Acting on **yourself** is always allowed — stepping down and handing over ownership
  stay possible; the `last_owner` guard is what keeps a workspace governable.

**Invites are multi-use until they expire or are revoked**: accepting does not consume
the token, so one link can admit several people for its full 14-day TTL. Bind an invite
to an `email` (or revoke it after use) when that is not what you want.

```json
// invite
{"id": "…", "workspace_id": "…", "role": "member", "email": null,
 "token": "…urlsafe…", "created_at": "…", "expires_at": "…"}
```

Membership changes bump the workspace version (members travel through sync).
A removed member loses sync/REST access immediately (`forbidden`).

## 8. Notification channels & reminders — v1.1

Per-user external channels — the self-hosted answer to app-store push relays.

| Endpoint | Notes |
|---|---|
| `GET /me/channels` | `{channels: [...]}` |
| `PUT /me/channels` | replaces the full list; validates per type |
| `POST /me/channels/test` | body `{type}` → sends a test message → `204`; delivery failure → `400 channel_unavailable` |

Channel shapes: `{"type": "ntfy", "url": "https://ntfy.sh/<topic>"}` ·
`{"type": "email", "address": "…"}` · `{"type": "telegram", "chat_id": "…"}`.
ntfy URLs must resolve to a public address, checked when stored and again at send
time; the request is then pinned to the address that was validated, so a rebinding
DNS answer cannot redirect it. Email requires server SMTP config (`BALU_SMTP_HOST/PORT/USER/PASSWORD/FROM`), telegram
requires `BALU_TELEGRAM_BOT_TOKEN`; configuring a channel whose transport is not set up
server-side → `400 channel_unavailable`.

Channel validation (v1.2.1):

- `ntfy.url` must be `http(s)` and must resolve to a **public** address. Loopback,
  private, link-local (incl. `169.254.169.254`), multicast and reserved ranges →
  `422 validation_error`. The check runs again at delivery time (DNS can change), and
  redirects are not followed.
- `email.address` must be a valid address **and equal the authenticated user's own
  account address** — there is no confirmation flow in v1, and an unverified destination
  would make the deployment's SMTP identity an open relay. Anything else →
  `422 validation_error`.

**Reminder delivery (server-side):** a background loop (~every 30 s) finds open,
non-deleted tasks with `reminder_at ≤ now` not yet sent, and delivers to the channels of
the **recipient = `assigned_to` ?? `created_by`**. Sent-state is server-internal (not in
sync payloads); changing `reminder_at` re-arms it. Message: task title, project name,
deadline if set. Mobile clients additionally schedule **local** notifications from their
replica; with external channels configured this can duplicate — accepted in v1.

**Event notifications (v1.2)** — sent through the same per-user channels, fire-and-forget
from the command handlers (failures logged, never fail the command):

- **Assignment**: `task_add`/`task_update`/`task_move` that sets `assigned_to` to a user
  other than the actor → notify the new assignee: actor name, task title, project,
  deadline if set.
- **Comment**: `comment_add` → notify the task's participants (assignee, task creator,
  prior comment authors) minus the comment's author: actor name, task title, body.
- No notification for self-actions. No batching/digest in v1.2 (accepted).

## 9. Static hosting & CORS

- The server serves the built web client: any non-`/api`, non-`/healthz` GET falls back
  to the SPA `index.html` from `server/static/` when that directory exists. A path that
  resolves outside `server/static/` is never served — the fallback returns `index.html`
  instead (percent-encoded `..` included).
- CORS: **same-origin by default** (v1.2.1 — the server serves its own SPA). Set
  `BALU_CORS_ORIGINS` to a comma-separated allow-list, or `*`, when the web client is
  hosted on a different origin. Credentials are bearer tokens, not cookies.

## 10. Remote MCP server - v1.3 (optional, off by default)

Off unless the deployment sets `BALU_MCP_ENABLED=true`. While off, **every endpoint in
this section 404s**, including the settings ones - which is also what an older server
without the feature does, so clients treat "404" as "hide the MCP section" rather than
special-casing a flag. None of these routes appear in `openapi.json`, enabled or not:
`/mcp` is JSON-RPC rather than REST, and the document should not vary with runtime
configuration.

**Per-user key.** Each user may hold one MCP bearer key, `balu_mcp_` + 256 bit urlsafe
random, stored in plaintext on `users.mcp_key` (unique, indexed). Plaintext is
deliberate: settings shows the key on every visit. It is **never minted implicitly** -
reading settings is not a request for a non-expiring full-access credential, and both
UIs read on mount only to decide whether to render the section. `POST /me/mcp/key` is
the single explicit action: it mints the first key and re-rolls any later one, and the
previous key stops authenticating immediately.

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /me/mcp` | access token | `{enabled, endpoint, key, claude_code_command}`; `key` is `null` until one is generated, and `claude_code_command` with it. Never writes. |
| `POST /me/mcp/key` | access token | generates/replaces the key, same response shape with `key` set |
| `POST /mcp` | `Authorization: Bearer <mcp key>` | the MCP endpoint (see below) |
| `GET /mcp` | - | `405` (no server-initiated SSE stream) |

`endpoint` is the absolute URL of `POST /mcp` as the server sees itself (honouring
`X-Forwarded-Proto` only under `BALU_TRUSTED_PROXY_HOPS`, counted from the right like
the rate limiter); `claude_code_command` is the ready-made `claude mcp add` line,
assembled server-side so the web and mobile settings screens cannot drift apart on it.

**Throttling:** `POST /me/mcp/key` is rate limited per client IP (20 per hour), and
`POST /mcp` per client IP on **failed** authentications only - a connected client makes
one POST per tool call and must never be throttled for working. Exceeding either limit →
`429 rate_limited` with `Retry-After`. `GET /me/mcp` writes nothing and is not limited.

**Transport.** MCP Streamable HTTP, JSON only: one JSON-RPC 2.0 request per POST,
answered with one `application/json` response. No session id, no SSE, no batching.

- Methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
- Only `2025-06-18` is negotiated. Earlier revisions require receivers to accept
  JSON-RPC batches, which this server does not implement, so advertising them would be
  a promise it does not keep; a client asking for another version gets `2025-06-18` back
  and decides for itself. Capabilities: `tools` only.
- Notifications (no `id`) get `202` with an empty body, whatever else is wrong with them.
- Unknown method → `-32601`. Unparseable body → HTTP `400` with `-32700`. Well-formed
  JSON that is not a request object (an array, say) → HTTP `400` with `-32600`.
- Missing/unknown key → `401` with `WWW-Authenticate: Bearer`, and the attempt spends
  rate-limit budget (see Throttling above).
- A tool that refuses (not a member, unknown label, viewer role) is a **successful**
  `tools/call` with `isError: true`, not a protocol error.

**Tools** - `list_workspaces`, `list_projects`, `list_tasks`, `get_task`, `create_task`,
`update_task`, `complete_task`, `reopen_task`, `add_comment`. Results are
`content: [{type: "text", text: "<JSON>"}]`.

Every mutation is expressed as a §5.4 command and applied through the same command
processor the sync endpoint uses, so role rank (`viewer` is read-only), version
stamping and §8 event notifications behave exactly as they do for any other client, and
the change shows up in the next sync pull on web and mobile. A tool that needs more than
one command (`update_task` moving a task *and* changing fields) validates every reference
first and then applies them one at a time: commands commit individually, so it stops at
the first rejection and the error names what did commit under `applied`.
