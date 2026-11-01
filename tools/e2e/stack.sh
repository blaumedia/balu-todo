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

ensure_env() {
  mkdir -p "$STATE"
  chmod 700 "$STATE"
  if [ ! -f "$ENVF" ]; then
    (umask 077; printf 'BALU_SECRET_KEY=%s\nBALU_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 16)" > "$ENVF")
  fi
}

dc() {
  docker compose -p "$PROJECT" -f "$ROOT/docker-compose.yml" --env-file "$ENVF" "$@"
}

cmd=${1:-}
[ $# -gt 0 ] && shift
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
    case "$STATE" in
      */balu-e2e/"$PROJECT") rm -rf "$STATE" ;;
      *) if [ -n "${BALU_E2E_STATE:-}" ]; then rm -rf "$STATE"; fi ;;
    esac
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
