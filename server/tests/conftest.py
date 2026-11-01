"""Pytest fixtures: real-Postgres schema (per session) + truncate isolation (per test)."""

from __future__ import annotations

import os
import threading
import time
import uuid

# Configure the environment BEFORE importing the app (settings are cached).
_TEST_DB_PORT = os.environ.get("BALU_TEST_DB_PORT") or os.environ.get("TEST_DB_PORT") or "5433"
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", f"postgresql+psycopg://balu:balu@localhost:{_TEST_DB_PORT}/balu_test"
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("SECRET_KEY", "test-secret-key-at-least-32-bytes-long-000")
os.environ["BALU_AUTO_MIGRATE"] = "0"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from balu.db import Base, get_engine, get_sessionmaker  # noqa: E402
from balu.main import app  # noqa: E402
from balu.migrate import run_migrations  # noqa: E402

# NOTE: ntfy channel URLs in the suite use a literal public IP (93.184.216.34)
# rather than a hostname — they pass through the SSRF guard (balu.urlguard),
# and an IP literal keeps the tests independent of DNS.


@pytest.fixture(scope="session", autouse=True)
def _schema():
    """Fresh schema for the whole test session via the real Alembic migration."""
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    run_migrations()
    yield


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """Auth throttling is in-process; each test starts from a clean slate."""
    from balu.ratelimit import limiter

    limiter.reset()
    yield


@pytest.fixture(autouse=True)
def _truncate():
    """Wipe all data between tests (the app commits on its own connections)."""
    yield
    engine = get_engine()
    tables = ", ".join(f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables))
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def db():
    sm = get_sessionmaker()
    session = sm()
    try:
        yield session
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def register_user(client: TestClient, email: str | None = None, name: str = "Dennis") -> dict:
    email = email or f"user-{uuid.uuid4().hex[:8]}@example.com"
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "password123", "name": name},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def sync(client: TestClient, user: dict, sync_token: str = "*", commands=None):
    resp = client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/sync",
        headers=user["headers"],
        json={"sync_token": sync_token, "commands": commands or []},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def cmd(type_: str, uuid_: str | None = None, temp_id: str | None = None, **args) -> dict:
    body: dict = {"type": type_, "uuid": uuid_ or str(uuid.uuid4()), "args": args}
    if temp_id is not None:
        body["temp_id"] = temp_id
    return body


def wait_for_lock_waiters(count: int, timeout: float = 10.0) -> None:
    """Block until `count` backends of the test database wait on a lock.

    The race tests need the request under test to be *at* the lock, not merely
    unfinished. One connection per poll: pg_stat_activity is snapshotted once per
    transaction.
    """
    engine = get_engine()
    deadline = time.monotonic() + timeout
    while True:
        with engine.connect() as conn:
            waiting = conn.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = current_database() AND wait_event_type = 'Lock'"
                )
            ).scalar_one()
        if waiting >= count:
            return
        if time.monotonic() > deadline:
            raise AssertionError(f"expected {count} lock waiter(s), saw {waiting}")
        time.sleep(0.02)


def strand(own_ws: uuid.UUID) -> None:
    """Test setup: delete a user's own workspace so only shared ones remain."""
    with get_sessionmaker()() as s:
        s.execute(text("DELETE FROM workspaces WHERE id = :w"), {"w": own_ws})
        s.commit()


class Background:
    """Run `fn` in a daemon thread; `result()` joins (bounded) and returns or re-raises."""

    def __init__(self, fn) -> None:
        self._outcome: dict = {}
        self._done = threading.Event()

        def run() -> None:
            try:
                self._outcome["value"] = fn()
            except BaseException as exc:  # re-raised by result()
                self._outcome["error"] = exc
            finally:
                self._done.set()

        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()

    def result(self, timeout: float = 15.0):
        self._thread.join(timeout)
        assert self._done.is_set(), "background call did not finish"
        if "error" in self._outcome:
            raise self._outcome["error"]
        return self._outcome["value"]


@pytest.fixture
def user(client: TestClient) -> dict:
    """A registered user with tokens and their personal workspace id."""
    data = register_user(client)
    me = client.get("/api/v1/me", headers=auth_headers(data["access_token"])).json()
    return {
        "user": data["user"],
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"],
        "headers": auth_headers(data["access_token"]),
        "workspace_id": me["memberships"][0]["workspace"]["id"],
    }
