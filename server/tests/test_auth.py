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
    # workspace named after the account, in full (I12: was split on the first space)
    assert membership["workspace"]["name"] == "Dennis Paul"


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


# ── S5: auth throttling + no login timing oracle ───────────────────────────
def test_login_is_rate_limited_per_account(client, user):
    from balu.ratelimit import LOGIN_PER_ACCOUNT

    email = user["user"]["email"]
    codes = []
    for _ in range(LOGIN_PER_ACCOUNT.limit + 2):
        resp = client.post(
            "/api/v1/auth/login", json={"email": email, "password": "wrong-password"}
        )
        codes.append(resp.status_code)
    assert 429 in codes
    assert codes[-1] == 429
    # And a correct password no longer gets through while throttled.
    resp = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "password123"}
    )
    assert resp.status_code == 429
    assert resp.json()["detail"]["code"] == "rate_limited"


def test_register_is_rate_limited(client):
    from balu.ratelimit import REGISTER_PER_IP

    codes = []
    for i in range(REGISTER_PER_IP.limit + 1):
        resp = client.post(
            "/api/v1/auth/register",
            json={"email": f"burst-{i}@example.com", "password": "password123", "name": "B"},
        )
        codes.append(resp.status_code)
    assert codes[-1] == 429


def test_unknown_email_still_costs_a_verification(client, monkeypatch):
    """No enumeration oracle: the not-found path must hash too (S5)."""
    import balu.routers.auth as auth_router

    calls = []
    monkeypatch.setattr(
        auth_router, "spend_verify_cost", lambda pw: calls.append(pw)
    )
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "password123"},
    )
    assert resp.status_code == 401
    assert calls == ["password123"]


# ── S12: logout burns the whole refresh-token family ───────────────────────
def test_logout_invalidates_earlier_tokens_in_the_family(client, user):
    first = user["refresh_token"]
    rotated = client.post("/api/v1/auth/refresh", json={"refresh_token": first})
    assert rotated.status_code == 200
    second = rotated.json()["refresh_token"]

    assert client.post("/api/v1/auth/logout", json={"refresh_token": second}).status_code == 204

    # The rotated-away token belonged to the same family and must be dead too.
    for token in (first, second):
        resp = client.post("/api/v1/auth/refresh", json={"refresh_token": token})
        assert resp.status_code == 401, token
