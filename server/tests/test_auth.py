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
    assert resp.json()["detail"]["code"] == "rate_limited"

    # ...but the account's real owner is never locked out by someone else's
    # failures. Charging the bucket before verification made an 8-guess denial
    # of service out of a brute-force defence; the streak is consulted only after
    # the password is checked, and a correct one clears it.
    ok = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert ok.status_code == 200
    again = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "wrong-password"}
    )
    assert again.status_code == 401, "a successful login should reset the streak"


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


def test_concurrent_refresh_with_one_token_is_a_replay(client):
    from balu.auth import rotate_refresh_token
    from balu.db import get_sessionmaker
    from tests.conftest import Background, wait_for_lock_waiters

    data = register_user(client)
    token = data["refresh_token"]
    with get_sessionmaker()() as s0:
        new_raw = rotate_refresh_token(s0, token)[1]
        s0.flush()
        bg = Background(
            lambda: client.post("/api/v1/auth/refresh", json={"refresh_token": token})
        )
        wait_for_lock_waiters(1)
        s0.commit()
    resp = bg.result()
    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "invalid_token"
    # The family is burned, exactly as for a sequential replay.
    again = client.post("/api/v1/auth/refresh", json={"refresh_token": new_raw})
    assert again.status_code == 401


def _family_of_three(client) -> tuple[str, str, str]:
    """Register, refresh twice: (revoked, revoked, live) tokens of one family."""
    data = register_user(client)
    t0 = data["refresh_token"]
    t1 = client.post("/api/v1/auth/refresh", json={"refresh_token": t0}).json()["refresh_token"]
    t2 = client.post("/api/v1/auth/refresh", json={"refresh_token": t1}).json()["refresh_token"]
    return t0, t1, t2


def test_replays_of_two_stale_tokens_of_one_family_do_not_deadlock(client):
    import threading

    from fastapi import HTTPException
    from sqlalchemy.orm import Session

    from balu.auth import rotate_refresh_token
    from balu.db import get_sessionmaker
    from tests.conftest import Background, wait_for_lock_waiters

    t0, t1, t2 = _family_of_three(client)
    # The first replay parks inside its family-wide burn, holding the family lock;
    # the second must be blocked on that lock (not holding a row lock of its own,
    # which is how the two used to cross) until the first is released.
    in_burn = threading.Event()
    release = threading.Event()

    class Parked(Session):
        def query(self, *args, **kwargs):
            in_burn.set()
            assert release.wait(timeout=10)
            return super().query(*args, **kwargs)

    def replay(token: str, session_cls: type[Session]) -> str:
        with session_cls(bind=get_sessionmaker().kw["bind"]) as s:
            try:
                rotate_refresh_token(s, token)
            except HTTPException as exc:
                return exc.detail["code"]
        return "rotated"

    a = Background(lambda: replay(t0, Parked))
    assert in_burn.wait(timeout=10)
    b = Background(lambda: replay(t1, Session))
    try:
        wait_for_lock_waiters(1)
    finally:
        release.set()
    assert (a.result(), b.result()) == ("invalid_token", "invalid_token")
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": t2}).status_code == 401


def test_replay_burns_a_successor_created_by_a_concurrent_rotation(client):
    from balu.auth import rotate_refresh_token
    from balu.db import get_sessionmaker
    from tests.conftest import Background, wait_for_lock_waiters

    data = register_user(client, email="burn@example.com")
    old = data["refresh_token"]
    cur = client.post("/api/v1/auth/refresh", json={"refresh_token": old}).json()["refresh_token"]
    with get_sessionmaker()() as s0:
        newest = rotate_refresh_token(s0, cur)[1]  # the thief's rotation, uncommitted
        s0.flush()
        bg = Background(
            lambda: client.post("/api/v1/auth/refresh", json={"refresh_token": old})
        )
        wait_for_lock_waiters(1)
        s0.commit()
    assert bg.result().status_code == 401
    # The replay burned the whole family, including the token just rotated in.
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": newest}).status_code == 401


def test_register_race_on_one_email_is_email_taken(client):
    from balu.db import get_sessionmaker
    from balu.models import User
    from tests.conftest import Background, wait_for_lock_waiters

    email = "race-taken@example.com"
    with get_sessionmaker()() as s0:
        s0.add(User(email=email, name="X", password_hash="x"))
        s0.flush()
        bg = Background(
            lambda: client.post(
                "/api/v1/auth/register",
                json={"email": email, "password": "password123", "name": "Y"},
            )
        )
        wait_for_lock_waiters(1)
        s0.commit()
    resp = bg.result()
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "email_taken"


def test_register_strips_the_name_and_rejects_a_blank_one(client):
    ok = client.post(
        "/api/v1/auth/register",
        json={"email": "pad@example.com", "password": "password123", "name": "  Anna  "},
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["user"]["name"] == "Anna"
    blank = client.post(
        "/api/v1/auth/register",
        json={"email": "blank@example.com", "password": "password123", "name": "   "},
    )
    assert blank.status_code == 422


def test_patch_me_rejects_a_blank_name(client, user):
    resp = client.patch("/api/v1/me", headers=user["headers"], json={"name": "   "})
    assert resp.status_code == 422
