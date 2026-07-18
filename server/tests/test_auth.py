"""Auth flow: register, login, refresh rotation + replay defense, /me."""

from __future__ import annotations

import balu.config
from tests.conftest import auth_headers, register_user


def test_register_creates_personal_workspace_owner(client):
    data = register_user(client, name="Dennis Paul")
    assert data["access_token"] and data["refresh_token"]
    assert data["user"]["email"].endswith("@example.com")

    me = client.get("/api/v1/me", headers=auth_headers(data["access_token"]))
    assert me.status_code == 200
    body = me.json()
    assert len(body["memberships"]) == 1
    membership = body["memberships"][0]
    assert membership["role"] == "owner"
    # workspace named after first name
    assert membership["workspace"]["name"] == "Dennis"


def test_register_duplicate_email(client):
    data = register_user(client, email="dup@example.com")
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "dup@example.com", "password": "password123", "name": "X"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "email_taken"
    assert data["user"]["email"] == "dup@example.com"


def test_register_short_password_rejected(client):
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "short@example.com", "password": "short", "name": "X"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "validation_error"


def test_login_success_and_failure(client):
    register_user(client, email="login@example.com")
    ok = client.post(
        "/api/v1/auth/login",
        json={"email": "login@example.com", "password": "password123"},
    )
    assert ok.status_code == 200
    assert ok.json()["access_token"]

    bad = client.post(
        "/api/v1/auth/login",
        json={"email": "login@example.com", "password": "wrongpass"},
    )
    assert bad.status_code == 401
    assert bad.json()["detail"]["code"] == "invalid_credentials"


def test_refresh_rotation_and_replay_invalidates_family(client):
    data = register_user(client, email="rot@example.com")
    first_refresh = data["refresh_token"]

    r1 = client.post("/api/v1/auth/refresh", json={"refresh_token": first_refresh})
    assert r1.status_code == 200
    second_refresh = r1.json()["refresh_token"]
    assert second_refresh != first_refresh

    # Replaying the old (rotated) token -> 401 invalid_token
    replay = client.post("/api/v1/auth/refresh", json={"refresh_token": first_refresh})
    assert replay.status_code == 401
    assert replay.json()["detail"]["code"] == "invalid_token"

    # ...and the whole family is now invalidated: the newer token is dead too.
    r2 = client.post("/api/v1/auth/refresh", json={"refresh_token": second_refresh})
    assert r2.status_code == 401
    assert r2.json()["detail"]["code"] == "invalid_token"


def test_logout_invalidates_refresh(client):
    data = register_user(client, email="out@example.com")
    resp = client.post("/api/v1/auth/logout", json={"refresh_token": data["refresh_token"]})
    assert resp.status_code == 204
    again = client.post("/api/v1/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert again.status_code == 401


def test_registration_disabled(client, monkeypatch):
    monkeypatch.setenv("BALU_ALLOW_REGISTRATION", "false")
    balu.config.get_settings.cache_clear()
    try:
        resp = client.post(
            "/api/v1/auth/register",
            json={"email": "nope@example.com", "password": "password123", "name": "X"},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "registration_disabled"
    finally:
        monkeypatch.delenv("BALU_ALLOW_REGISTRATION", raising=False)
        balu.config.get_settings.cache_clear()


def test_me_requires_auth(client):
    resp = client.get("/api/v1/me")
    assert resp.status_code == 401


def test_patch_me(client):
    data = register_user(client, email="patch@example.com")
    resp = client.patch(
        "/api/v1/me",
        headers=auth_headers(data["access_token"]),
        json={"name": "Neu", "locale": "de", "theme": "dark"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Neu"
    assert body["locale"] == "de"
    assert body["theme"] == "dark"
