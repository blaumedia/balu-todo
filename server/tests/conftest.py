"""Pytest fixtures: real-Postgres schema (per session) + truncate isolation (per test)."""

from __future__ import annotations

import os
import uuid

# Configure the environment BEFORE importing the app (settings are cached).
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://balu:balu@localhost:5433/balu_test"
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
