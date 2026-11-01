#!/bin/sh
# Dedicated e2e compose stack (own project, own volumes, own port). Usage:
#   stack.sh up|down|purge|ps|logs|psql [args]|task TITLE|tokens|mcp [on|off]
# Secrets for the stack are generated into $STATE/stack.env (mode 600) and never printed.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
# Default name: ASCII-lowercase, every byte outside [a-z0-9_-] becomes '-' (LC_ALL=C makes tr
# byte-wise; same rule as balu_e2e.py and the server Makefile).
DEFAULT_PROJECT=balu-e2e-$(basename "$ROOT" | LC_ALL=C tr 'A-Z' 'a-z' | LC_ALL=C tr -c 'a-z0-9_\n-' '-')
PROJECT=${BALU_E2E_PROJECT:-$DEFAULT_PROJECT}
# `purge` deletes the project's volumes, so only a name that cannot be a dev project is accepted.
PROJECT_MSG="BALU_E2E_PROJECT must start with balu-e2e- and match [a-z0-9_-]+ (purge deletes the project's volumes; compose needs lowercase)"
case "$PROJECT" in
  balu-e2e-*[!abcdefghijklmnopqrstuvwxyz0123456789_-]* | balu-e2e-) echo "$PROJECT_MSG" >&2; exit 2 ;;
  balu-e2e-*) ;;
  *) echo "$PROJECT_MSG" >&2; exit 2 ;;
esac
# BALU_E2E_PORT first so the dev stack's BALU_PORT (root .env) does not leak in; same order as balu_e2e.py
PORT=${BALU_E2E_PORT:-${BALU_PORT:-8090}}
export BALU_PORT="$PORT"
# Shell values beat --env-file in compose interpolation: drop everything docker-compose.yml
# interpolates (besides BALU_PORT) so a direnv-loaded root .env cannot leak into the stack.
unset BALU_SECRET_KEY BALU_DB_PASSWORD BALU_ALLOW_REGISTRATION BALU_CORS_ORIGINS
STATE=${BALU_E2E_STATE:-$HOME/.cache/balu-e2e/$PROJECT}
ENVF=$STATE/stack.env

MARKER=$STATE/.balu-e2e-state

ensure_env() {
  # Adopt a directory only when it is new, empty or already ours, so `purge` can
  # never be pointed at an unrelated directory by a stray BALU_E2E_STATE.
  if [ ! -f "$MARKER" ] && [ -d "$STATE" ] && [ -n "$(ls -A "$STATE")" ]; then
    echo "refusing to use $STATE: not empty and not created by stack.sh" >&2
    exit 1
  fi
  mkdir -p "$STATE"
  chmod 700 "$STATE"
  : > "$MARKER"
  # BALU_MCP_ENABLED reaches the app only through this override (the base compose
  # file forwards no variables and the root .env is dropped), driven by the
  # $STATE/mcp flag that `stack.sh mcp on|off` writes.
  (umask 077; printf 'services:\n  app:\n    env_file: !reset []\n' > "$OVERRIDE")
  if [ -f "$STATE/mcp" ]; then
    (umask 077; printf '    environment:\n      BALU_MCP_ENABLED: "true"\n' >> "$OVERRIDE")
  fi
  if [ ! -f "$ENVF" ]; then
    (umask 077; printf 'BALU_SECRET_KEY=%s\nBALU_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 16)" > "$ENVF")
  fi
}

# The override drops the checkout's root .env from the app container, so real SMTP,
# Telegram and BALU_DEV values never reach the throwaway stack (`!reset` needs compose >= 2.24).
OVERRIDE=$STATE/override.yml

dc() {
  docker compose -p "$PROJECT" -f "$ROOT/docker-compose.yml" -f "$OVERRIDE" --env-file "$ENVF" "$@"
}

cmd=${1:-}
[ $# -gt 0 ] && shift
# An unmarked non-empty state dir is never adopted, written to or deleted. `purge` still
# tears the compose project down by its labels (no -f/--env-file, so nothing is read from
# or written into the dir) and keeps the dir.
if [ "$cmd" = purge ] && [ ! -f "$MARKER" ] && [ -d "$STATE" ] && [ -n "$(ls -A "$STATE")" ]; then
  docker compose -p "$PROJECT" down -v
  echo "purged containers and volumes; kept $STATE (not created by stack.sh, delete it yourself)"
  exit 0
fi
ensure_env

case "$cmd" in
  up)
    if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && [ -z "$(dc ps -q app)" ]; then
      echo "port $PORT is served by another stack; set BALU_E2E_PORT" >&2
      exit 1
    fi
    dc up -d --build
    i=0
    until curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; do
      i=$((i + 1))
      if [ "$i" -gt 180 ]; then
        echo "stack did not become healthy within 180 s" >&2
        exit 1
      fi
      sleep 1
    done
    echo "up: project=$PROJECT port=$PORT"
    ;;
  down)
    dc down
    ;;
  purge)
    dc down -v
    # ensure_env has just adopted the dir (new, empty or marked), so it is ours to remove.
    rm -rf "$STATE"
    echo "purged"
    ;;
  ps)
    dc ps
    ;;
  logs)
    dc logs --tail 200 app
    ;;
  psql)
    dc exec -T db psql -U balu -d balu -At "$@"
    ;;
  task)
    : "${1:?usage: stack.sh task TITLE}"
    echo "select title, coalesce(reminder_at::text,'NULL'), coalesce(start_date::text,'NULL'), updated_at, is_deleted from tasks where title = :'title' order by created_at desc limit 1;" \
      | dc exec -T db psql -U balu -d balu -At -v title="$1"
    ;;
  tokens)
    echo "select u.email, count(*) total, count(*) filter (where not r.revoked) active from refresh_tokens r join users u on u.id = r.user_id where u.email like :'pat' group by u.email order by 1;" \
      | dc exec -T db psql -U balu -d balu -At -v pat="e2e-${BALU_E2E_RUN:-$(date +%Y%m%d)}-%"
    ;;
  mcp)
    # Toggle the MCP server of the e2e stack: rewrites the override and recreates
    # only the app container (no rebuild). With no argument, prints the state.
    case "${1:-}" in
      on) (umask 077; : > "$STATE/mcp") ;;
      off) rm -f "$STATE/mcp" ;;
      "") [ -f "$STATE/mcp" ] && echo "mcp on" || echo "mcp off"; exit 0 ;;
      *) echo "usage: stack.sh mcp [on|off]" >&2; exit 2 ;;
    esac
    ensure_env
    if [ -n "$(dc ps -q app)" ]; then
      dc up -d --no-build --force-recreate app
    fi
    echo "mcp ${1}"
    ;;
  *)
    echo "usage: stack.sh up|down|purge|ps|logs|psql|task TITLE|tokens|mcp [on|off]" >&2
    exit 2
    ;;
esac
