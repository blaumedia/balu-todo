# Per-checkout project so two worktrees never share (or tear down) one test DB;
# override TEST_DB_PORT when another checkout's test DB already holds 5433.
TEST_DB_PORT ?= 5433
TEST_PROJECT ?= balu-test-$(notdir $(abspath ..))
COMPOSE := BALU_TEST_DB_PORT=$(TEST_DB_PORT) docker compose -p $(TEST_PROJECT) -f tests/docker-compose.test.yml
TEST_DATABASE_URL ?= postgresql+psycopg://balu:balu@localhost:$(TEST_DB_PORT)/balu_test

.PHONY: install dev test test-db-up test-db-down lint fmt migrate

install:
	uv sync

dev:
	uv run uvicorn balu.main:app --reload --host 0.0.0.0 --port 8000

test-db-up:
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
	uv run ruff check .

fmt:
	uv run ruff check --fix .
	uv run ruff format .

migrate:
	uv run python -m balu.migrate
