"""Rate limiter: identity spoofing, memory bounds, and lockout behaviour.

These cover the three ways the first cut of the limiter was wrong:
an attacker-controlled bucket key, a table that never shrank, and an account
bucket that let anyone lock a known address out by guessing wrong.
"""

from __future__ import annotations

import pytest

from balu.config import get_settings
from balu.ratelimit import (
    LOGIN_PER_ACCOUNT,
    MAX_TRACKED_KEYS,
    RateLimit,
    SlidingWindowLimiter,
    client_ip,
    limiter,
)


class _Req:
    """Minimal stand-in for a Starlette Request."""

    def __init__(self, headers: dict[str, str], host: str | None = "10.0.0.1") -> None:
        self.headers = headers
        self.client = type("C", (), {"host": host})() if host else None


# ---------------------------------------------------------------------------
# Window arithmetic
# ---------------------------------------------------------------------------
def test_check_does_not_consume_budget():
    lim = SlidingWindowLimiter()
    rule = RateLimit(2, 100.0)
    for _ in range(50):
        assert lim.check("k", rule, now=1000.0)
    assert lim.allow("k", rule, now=1000.0)
    assert lim.allow("k", rule, now=1000.0)
    assert not lim.check("k", rule, now=1000.0)


def test_window_expires():
    lim = SlidingWindowLimiter()
    rule = RateLimit(1, 100.0)
    assert lim.allow("k", rule, now=1000.0)
    assert not lim.check("k", rule, now=1050.0)
    assert lim.check("k", rule, now=1101.0)


# ---------------------------------------------------------------------------
# Identity must not be attacker-controlled
# ---------------------------------------------------------------------------
def test_forwarded_for_ignored_when_not_behind_a_proxy():
    """The default deployment is directly exposed: XFF is just a client header.

    Honouring it unconditionally let anyone mint a fresh bucket per request, so
    the limiter counted nothing.
    """
    get_settings.cache_clear()
    assert client_ip(_Req({"x-forwarded-for": "203.0.113.7"})) == "10.0.0.1"
    assert client_ip(_Req({"x-forwarded-for": "203.0.113.8"})) == "10.0.0.1"


def test_forwarded_for_is_read_from_the_right_not_the_left(monkeypatch):
    """Proxies *append*, so the leftmost entry is whatever the client sent.

    Reading `split(",")[0]` made the header spoofable again in exactly the
    deployment the setting exists for: a client sending its own X-Forwarded-For
    would own the leftmost slot and mint a fresh bucket per request. With one
    trusted hop, the address that hop observed is the *last* entry.
    """
    monkeypatch.setenv("BALU_TRUSTED_PROXY_HOPS", "1")
    get_settings.cache_clear()
    try:
        # "<spoofed by client>, <what the proxy actually saw>"
        req = _Req({"x-forwarded-for": "203.0.113.7, 198.51.100.4"})
        assert client_ip(req) == "198.51.100.4"
    finally:
        monkeypatch.delenv("BALU_TRUSTED_PROXY_HOPS", raising=False)
        get_settings.cache_clear()


def test_forwarded_for_respects_a_deeper_chain(monkeypatch):
    monkeypatch.setenv("BALU_TRUSTED_PROXY_HOPS", "2")
    get_settings.cache_clear()
    try:
        req = _Req({"x-forwarded-for": "203.0.113.7, 198.51.100.4, 10.0.0.9"})
        assert client_ip(req) == "198.51.100.4"
    finally:
        monkeypatch.delenv("BALU_TRUSTED_PROXY_HOPS", raising=False)
        get_settings.cache_clear()


def test_short_forwarded_chain_falls_back_to_the_socket_peer(monkeypatch):
    """A header shorter than the configured depth isn't the chain we were told
    about, so trusting it would let a client shorten its way to a free bucket."""
    monkeypatch.setenv("BALU_TRUSTED_PROXY_HOPS", "2")
    get_settings.cache_clear()
    try:
        assert client_ip(_Req({"x-forwarded-for": "203.0.113.7"})) == "10.0.0.1"
        assert client_ip(_Req({})) == "10.0.0.1"
    finally:
        monkeypatch.delenv("BALU_TRUSTED_PROXY_HOPS", raising=False)
        get_settings.cache_clear()


def test_limiter_is_thread_safe():
    """`_sweep` iterating `_hits` while another thread inserts used to raise
    "dictionary changed size during iteration" — a 500 on login."""
    import threading

    lim = SlidingWindowLimiter()
    rule = RateLimit(1_000_000, 300.0)
    errors: list[BaseException] = []

    def worker(n: int) -> None:
        try:
            for i in range(2_000):
                lim.allow(f"k{n}-{i}", rule)
        except BaseException as exc:  # noqa: BLE001 - recorded and re-raised below
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, f"concurrent access raised: {errors[:3]}"


def test_falls_back_to_unknown_without_a_client():
    get_settings.cache_clear()
    assert client_ip(_Req({}, host=None)) == "unknown"


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------
def test_key_table_is_hard_capped():
    """Cycling identities must not grow the process without bound."""
    lim = SlidingWindowLimiter()
    rule = RateLimit(5, 300.0)
    peak = 0
    for i in range(MAX_TRACKED_KEYS * 3):
        lim.record(f"k{i}", rule, now=0.0)
        peak = max(peak, lim.tracked_keys())
    assert peak <= MAX_TRACKED_KEYS + 1


def test_stale_buckets_are_reclaimed():
    lim = SlidingWindowLimiter()
    rule = RateLimit(5, 300.0)
    for i in range(500):
        lim.record(f"old{i}", rule, now=0.0)
    assert lim.tracked_keys() == 500
    for _ in range(256):  # drive a sweep at a much later "now"
        lim.record("live", rule, now=100_000.0)
    assert lim.tracked_keys() == 1


def test_sweep_horizon_self_registers_new_rules(monkeypatch):
    """A rule declared anywhere must widen the sweep horizon on its own.

    It used to be a hand-maintained max over the four auth rules, so a bucket
    could be swept while a wider rule's window still counted its hits - handing
    that budget back for free.
    """
    import balu.ratelimit as ratelimit

    monkeypatch.setattr(ratelimit, "_longest_window", 0.0)
    rule = RateLimit(5, 10_000.0)
    assert ratelimit.longest_window() == 10_000.0

    lim = SlidingWindowLimiter()
    lim.record("old", rule, now=0.0)
    for _ in range(256):  # drives a sweep, still inside `rule`'s window
        lim.record("live", rule, now=9_000.0)
    assert lim.tracked_keys() == 2


def test_check_leaves_no_empty_bucket_behind():
    lim = SlidingWindowLimiter()
    lim.check("never-seen", RateLimit(5, 300.0), now=0.0)
    assert lim.tracked_keys() == 0


# ---------------------------------------------------------------------------
# Login lockout
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _reset():
    limiter.reset()
    yield
    limiter.reset()


def _register(client, email: str, password: str = "correct-horse-battery"):
    return client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "name": "Dennis"},
    )


def test_wrong_passwords_do_not_lock_out_the_real_owner(client):
    """Regression: the account bucket used to be charged on every attempt.

    Anyone who knew an address could burn it with wrong guesses and lock that
    user out for the whole window. A correct password must always get through.
    (Failures still exhaust the bucket, but since verification now happens first,
    that only changes the status code of a wrong guess — the per-IP bucket and
    argon2's cost are what actually cap guessing.)
    """
    email = "victim@example.com"
    password = "correct-horse-battery"
    assert _register(client, email, password).status_code == 201

    for _ in range(LOGIN_PER_ACCOUNT.limit + 4):
        resp = client.post(
            "/api/v1/auth/login", json={"email": email, "password": "wrong-guess"}
        )
        assert resp.status_code in (401, 429)

    ok = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert ok.status_code == 200


def test_failed_logins_are_still_throttled(client):
    email = "bruteforced@example.com"
    assert _register(client, email).status_code == 201
    codes = [
        client.post(
            "/api/v1/auth/login", json={"email": email, "password": f"guess-{i}"}
        ).status_code
        for i in range(LOGIN_PER_ACCOUNT.limit + 3)
    ]
    assert 429 in codes, "repeated failures on one account must start being refused"
