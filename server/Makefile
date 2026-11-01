# Per-checkout project so two worktrees never share (or tear down) one test DB;
# override TEST_DB_PORT when another checkout's test DB already holds 5433.
TEST_DB_PORT ?= $(or $(BALU_TEST_DB_PORT),5433)
# Override TEST_PROJECT if two checkouts share a directory name.
TEST_PROJECT ?= balu-test-$(shell basename "$$(cd .. && pwd)" | LC_ALL=C tr 'A-Z' 'a-z' | LC_ALL=C tr -c 'a-z0-9_\n-' '-')
COMPOSE := BALU_TEST_DB_PORT=$(TEST_DB_PORT) docker compose -p $(TEST_PROJECT) -f tests/docker-compose.test.yml
TEST_DATABASE_URL ?= postgresql+psycopg://balu:balu@localhost:$(TEST_DB_PORT)/balu_test

.PHONY: install dev test test-db-up test-db-down lint fmt migrate

install:
	uv sync

dev:
	uv run uvicorn balu.main:app --reload --host 0.0.0.0 --port 8000

# publish= matches the host-side port (verified), so a legacy 5433:5432 container is found by 5433.
test-db-up:
	@if [ -n "$$(docker ps -q -f name='^balu-test-db$$' -f publish=$(TEST_DB_PORT))" ]; then \
		echo "a running legacy container balu-test-db publishes port $(TEST_DB_PORT): stop it if no older checkout is using it, or pick another TEST_DB_PORT" >&2; exit 1; fi
	$(COMPOSE) up -d
	@echo "waiting for postgres..."
	@for i in $$(seq 1 30); do \
		if $(COMPOSE) exec -T balu-test-db pg_isready -U balu -d balu_test >/dev/null 2>&1; then \
			echo "ready"; exit 0; fi; \
		sleep 1; \
	done; echo "postgres did not become ready" >&2; exit 1

test-db-down:
	$(COMPOSE) down -v

test: test-db-up
	TEST_DATABASE_URL=$(TEST_DATABASE_URL) uv run pytest

lint:
	uv run ruff check . ../tools/e2e

fmt:
	uv run ruff check --fix . ../tools/e2e
	uv run ruff format .

migrate:
	uv run python -m balu.migrate
