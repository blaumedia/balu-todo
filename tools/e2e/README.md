# e2e helpers

Reusable helpers for end-to-end runs against a real balu stack: API seeding, a
dedicated compose stack, a control proxy, web invite links and an Android emulator
runbook. Python is stdlib only (3.11+), shell is POSIX `sh`.

## 1. What this is and where the state lives

State lives in `~/.cache/balu-e2e/<project>/<run>/` (mode 700; `stack.env` and the other
stack files sit one level up). It holds the generated passwords, tokens, ids and `stack.env`.
**Never cat it.** No script here prints a password, an access or refresh token, an invite
token or a request/response body.

The default project is `balu-e2e-<checkout dir>`. Environment variables:

| Variable | Meaning |
|---|---|
| `BALU_E2E_PORT` | host port of the stack, used by `stack.sh` and the Python helpers alike; falls back to `BALU_PORT`, then 8090. Prefer it: `BALU_PORT` is usually the dev stack's port (root `.env`) |
| `BALU_E2E_ALLOW_REMOTE` | set to `1` to let `BALU_E2E_BASE` point at a non-local host (default: only 127.0.0.1, localhost, ::1; the helpers register users and create data) |
| `BALU_E2E_PROJECT` | compose project name, must start with `balu-e2e-` and match `[a-z0-9_-]+` (`purge` deletes the project's volumes, so a dev project name such as `balu-wt-x` is refused; `stack.sh` and the Python helpers both enforce it). Default: `balu-e2e-<checkout dir>`, lowercased with other characters turned into `-` |
| `BALU_E2E_STATE` | state directory |
| `BALU_E2E_RUN` | run id (`[A-Za-z0-9_-]+`), default today; used in emails `e2e-<run>-<role>@example.com` |
| `BALU_E2E_BASE` | API base URL override |
| `BALU_E2E_PUBLIC_BASE` | base URL `invite_shim.py` redirects to (default `http://localhost:<BALU_E2E_PORT>`) |
| `BALU_ANDROID_PACKAGE` | app id for `android/cold.sh` (default `com.blaumedia.balutodo`) |
| `METRO_PORT` | Metro port for `android/cold.sh --dev-client` (default 8081) |
| `ANDROID_SERIAL` | required for everything under `android/` |

## 2. Stack

`stack.sh up|down|purge|ps|logs|psql|task|tokens|mcp [on|off]`

- Health is `GET /healthz`, not `/api/v1/health`.
- The image is built, not live-mounted. Run `up` again after code changes.
- Never use the project `balu` (the dev data); `stack.sh` refuses it.
- Cleanup is `stack.sh purge` (removes containers, volumes and the state dir). Every other
  `stack.sh` command (default path too) and the Python helpers refuse a state dir that is
  non-empty and lacks the `.balu-e2e-state` marker; both write the marker when they create
  the dir or find it empty. On such an unmarked dir `purge` writes nothing: it only runs
  `docker compose -p <project> down -v` (found by project label), keeps the dir and says
  so. A marked, empty or absent dir is removed as usual.
- **State dirs from before the marker:** check what is in the dir, then
  `touch <state dir>/.balu-e2e-state`; after that `stack.sh` works again.
- **After upgrading to the per-run layout** (`<state>/<run>/`): old `*.pw`, `*.tok`, ids and
  `tasks.json` at the state root are not migrated. Use a new `BALU_E2E_RUN` (or `stack.sh
  purge`), otherwise the freshly generated password no longer matches the account already
  registered for that run (login 401). The old root files can be deleted.
- `stack.sh` unsets `BALU_SECRET_KEY`, `BALU_DB_PASSWORD`, `BALU_ALLOW_REGISTRATION` and
  `BALU_CORS_ORIGINS` (shell values would beat the generated env file), and exports
  `BALU_PORT` from `BALU_E2E_PORT`; a direnv-loaded root `.env` cannot change the stack.
- The app container does **not** read the checkout's root `.env`: `stack.sh` adds an override
  (`env_file: !reset []`, compose >= 2.24) so real SMTP/Telegram/`BALU_DEV` values stay out.
- **MCP toggle:** `stack.sh mcp on|off` (no argument prints the state) sets
  `BALU_MCP_ENABLED=true` for the app service through the compose override in the state dir
  (the base `docker-compose.yml` forwards no variables and the root `.env` is dropped, so
  this is the only way in). It recreates just the app container, without a rebuild; the flag
  persists across `up`. Check with an authenticated `GET /api/v1/me/mcp?probe=true`
  (session bearer token, e.g. from `api.py`; a plain curl gets 401): the body is
  `{"enabled": false}` while off, and carries `endpoint` and `key` as well while on.
- A non-2xx response makes the `api.py` subcommands exit 1.
- `task TITLE` prints one task row, `tokens` prints refresh-token counts per account.

## 3. API helpers

`api.py <subcommand>`:

| Subcommand | What it does |
|---|---|
| `health` | `healthz <status>` |
| `setup [--member-role R] [--tasks N]` | registers owner and member, invites, seeds a project and N tasks |
| `role ROLE` | changes the member's role |
| `bulk N` | adds N tasks |
| `edit-task TITLE FIELD VALUE` | `task_update` as owner |
| `delete-task TITLE` | `task_delete` as owner |
| `project-delete` | deletes the seeded project |
| `remove-member` | removes the member from the workspace |
| `ws2` | creates a second workspace with a project and a task |
| `sync-probe [--role R]` | task and project counts as seen by a role |
| `me [--role R]` | membership count and roles |
| `invite ROLE` | owner creates an invite; the token is saved to the state dir |

- Access tokens expire after 30 min; the helpers re-login after 25 min or on a 401.
- Login is limited to 30 per 5 min per IP and 8 per 5 min per account. Registration is
  limited to 10 per hour per IP (`server/balu/ratelimit.py:55-57`), so `setup` is
  idempotent and reuses accounts.
- Every `*_add` uses a fresh `temp_id` (a reused one maps to the earlier object).

## 4. Control proxy

Start the stack on 8091 (`BALU_E2E_PORT=8091 stack.sh up`), then
`proxy.py serve --listen 8090 --upstream http://127.0.0.1:8091`. The emulator talks to
`http://10.0.2.2:8090`; the API helpers bypass the proxy and use `BALU_E2E_PORT=8091`.

`proxy.py ctl on|off dark|dark_on_403|me_empty` switches the failure modes (see the
header of `proxy.py`).

## 5. Web invites without leaking tokens

`api.py invite viewer`, then `invite_shim.py` (port 8099), then open
`http://127.0.0.1:8099/invite/viewer` in Playwright. The shim redirects to the real
invite URL, so the helpers never type or print the token. The browser tool still reports the
page URL after the redirect, which contains the token: treat that output as sensitive.

## 6. Android emulator runbook

- **Clone an AVD, never reuse one another agent runs.** The base `BaluE2EMobile` AVD is
  assumed to exist; create it with e.g.
  `avdmanager create avd -n BaluE2EMobile -k "system-images;android-34;google_apis;arm64-v8a"`.
  `cp -cR` is macOS/APFS only (use `cp -R` elsewhere):

  ```sh
  cd ~/.android/avd
  cp -cR BaluE2EMobile.avd <Clone>.avd
  sed 's#BaluE2EMobile.avd#<Clone>.avd#' BaluE2EMobile.ini > <Clone>.ini
  rm -f <Clone>.avd/*.lock
  ```

  Then set `AvdId=<Clone>` and `avd.ini.displayname=<Clone>` in `<Clone>.avd/config.ini`.
  Start it with `emulator -avd <Clone> -port <free even port 5554-5682> -no-snapshot-save &`
  and `export ANDROID_SERIAL=emulator-<port>`.
- **The shared `Medium_Phone` AVD may carry a stale logged-in app.** After cloning, run
  `adb -s <own serial> shell pm clear "${BALU_ANDROID_PACKAGE:-com.blaumedia.balutodo}"`
  before testing.
- **Never touch other emulators:** no `adb kill-server`, no `adb emu kill` without your
  own `-s`, no install or uninstall on a serial you did not start.
- Server URL in the app: `http://10.0.2.2:<port>`.
- **Release build for offline or cold-start tests**, because the dev client needs Metro
  to load the bundle: `cd apps/mobile && npx expo run:android --variant release --device <Clone>`.
  `npx expo run:android --help` lists `--variant <name>` (default debug) and
  `-d, --device [device]`, plus `--no-bundler`, `--binary <path>` and `--app-id`.
- **Dev-client deep link:**
  `android/cold.sh --dev-client "balu://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081"`.
- App deep links use the scheme `balu://` (`apps/mobile/app.json:8`).
- **A viewer, after accepting an invite, starts on their own personal workspace.**
  Switch workspaces in the app before asserting on the shared one.
- **No status-bar tap after a cold start.**
- `adb shell input text` needs `%s` for spaces. `android/ui.py type` does this.
- Android date and time pickers follow the **system** locale, not the app locale.
- uiautomator dumps never contain password-field text (`ui.py` filters `password="true"`
  nodes). Do not bypass `ui.py` for dumps.
- `android/dot.py` needs Pillow (`uv run --python 3.11 --with pillow python ...`) and the current header layout.

Scripts: `android/ui.py` (list, tap, has, dump, swipe, state, type), `android/login.py ROLE`,
`android/cold.sh`, `android/dot.py [--watch SECONDS]`.

## 7. What was deliberately not committed

Earlier ad-hoc helpers were dropped:

- `web2/api.py`: hardcoded password literal. Superseded by `balu_e2e.py`.
- `web2/watch.py`: hardcoded container name, SQL built by string interpolation,
  one-scenario timing.
- `web4/seed.py`, `web4/s12_setup.py`, `web5/seed5.py`, `web5/s5api.py`: scenario-specific,
  depend on the old password, reuse a hardcoded `temp_id`.
- `android2/setup2.py`, `setup3.py`, `solo_project_delete.py`, `android5/setup5.py`: one-off
  fixtures.
- `android5/scroll_check.py`: one-scenario check; its password-skip idea is now in `ui.py`.
- `android3/t.sh`, `cold2.sh`, `back1.sh`: logcat debugging for a fixed bug, hardcoded serial.
- `focus.sh`: now `ui.py state`.
- `android6/drag.sh`: absolute coordinates for one screen.
- `helpers/login.sh`, `android6/login.py`, `ui_login.py`: duplicates of `android/login.py`.
- `helpers/taskstate.sh`, `tokens.sh`: hardcoded container name and SQL injection. Now
  `stack.sh task|tokens`.
- All logs, PNGs and `onboarding.good`.
