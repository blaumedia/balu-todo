#!/bin/sh
# Dedicated e2e compose stack (own project, own volumes, own port). Usage:
#   stack.sh up|down|purge|ps|logs|psql [args]|task TITLE|tokens
# Secrets for the stack are generated into $STATE/stack.env (mode 600) and never printed.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PROJECT=${BALU_E2E_PROJECT:-balu-e2e-$(basename "$ROOT")}
PORT=${BALU_PORT:-8090}
export BALU_PORT="$PORT"
STATE=${BALU_E2E_STATE:-$HOME/.cache/balu-e2e/$PROJECT}
ENVF=$STATE/stack.env

if [ "$PROJECT" = "balu" ]; then
  echo "refusing to touch the dev project 'balu'" >&2
  exit 2
fi

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
  (umask 077; printf 'services:\n  app:\n    env_file: !reset []\n' > "$OVERRIDE")
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
if [ "$cmd" = "purge" ] && [ ! -f "$MARKER" ]; then
  echo "not purging $STATE: no marker file created by stack.sh" >&2
  exit 1
fi
ensure_env

case "$cmd" in
  up)
    if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && [ -z "$(dc ps -q app)" ]; then
      echo "port $PORT is served by another stack; set BALU_PORT" >&2
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
    # Only a directory this script created (it holds the .balu-e2e-state marker) is removed.
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
  *)
    echo "usage: stack.sh up|down|purge|ps|logs|psql|task TITLE|tokens" >&2
    exit 2
    ;;
esac
