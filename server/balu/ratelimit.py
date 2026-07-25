"""In-process sliding-window rate limiting for the auth endpoints (§1).

Balu is a single-container self-hosted app, so an in-memory limiter is the right
size: no extra dependency, no shared state to operate. It is per-process — if you
ever run several app workers, put the real limit in the reverse proxy as well.

Two properties matter beyond the window arithmetic:

* **The client identity must not be attacker-controlled.** ``X-Forwarded-For`` is
  only consulted when ``BALU_TRUSTED_PROXY_HOPS`` declares how many proxies sit in
  front, and is then counted from the right — proxies *append*, so the leftmost
  entry is whatever the client sent. Otherwise anyone could mint a fresh bucket
  per request by setting a header.
* **Buckets must not accumulate.** Keys are swept once their window has fully
  elapsed, and the table is hard-capped, so an unauthenticated caller cannot grow
  the process indefinitely.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass

from .config import get_settings


@dataclass(frozen=True)
class RateLimit:
    """`limit` events allowed per rolling `window` seconds."""

    limit: int
    window: float


# Login: generous enough for a shared NAT, tight enough to stop credential
# stuffing. The per-account bucket is what actually protects one user.
LOGIN_PER_IP = RateLimit(30, 300)
LOGIN_PER_ACCOUNT = RateLimit(8, 300)
REGISTER_PER_IP = RateLimit(10, 3600)
REFRESH_PER_IP = RateLimit(120, 300)

# Upper bound on tracked buckets. Reaching it means either a very busy instance
# or someone cycling identities; either way we drop the coldest entries rather
# than grow without bound.
MAX_TRACKED_KEYS = 10_000
_SWEEP_EVERY = 256


class SlidingWindowLimiter:
    """Thread-safe sliding-window counter.

    `allow` is what production uses; `check`/`record` are the same halves exposed
    separately for tests.

    On the account bucket, note what the current design does and does not buy.
    `auth.login` calls `allow` only **after** verifying the password, so an
    attacker's failures can never lock the real owner out — but the flip side is
    that every attempt is still fully verified, so the per-account bucket changes
    only the status code of a wrong guess, not whether the guess was tested. The
    real cap on guessing is `LOGIN_PER_IP` plus argon2's cost. That is the usual
    trade (lockout-DoS vs. brute force); if the stronger property is ever wanted
    back, escalating per-account delay is the way, not a 429 after the fact.

    Every method takes `_lock`: FastAPI runs `def` handlers in a threadpool, and
    an unsynchronised `_sweep` would raise "dictionary changed size during
    iteration" mid-login. Contention is negligible at auth request rates.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._ops = 0
        # FastAPI runs `def` handlers in a threadpool, so login/register/refresh
        # mutate this from many threads at once. Unsynchronised, `_sweep`'s
        # iteration over `_hits` raises "dictionary changed size during
        # iteration" — a 500 on login, during exactly the burst the limiter exists for.
        self._lock = threading.Lock()

    def _prune(self, key: str, cutoff: float) -> deque[float]:
        hits = self._hits.get(key)
        if hits is None:
            hits = deque()
            self._hits[key] = hits
        while hits and hits[0] <= cutoff:
            hits.popleft()
        return hits

    def _sweep(self, now: float) -> None:
        """Drop buckets whose newest hit is older than the longest window."""
        horizon = now - max(
            r.window
            for r in (LOGIN_PER_IP, LOGIN_PER_ACCOUNT, REGISTER_PER_IP, REFRESH_PER_IP)
        )
        stale = [k for k, hits in self._hits.items() if not hits or hits[-1] <= horizon]
        for k in stale:
            del self._hits[k]
        if len(self._hits) > MAX_TRACKED_KEYS:
            # Still over budget: evict the coldest buckets (oldest newest-hit).
            by_age = sorted(self._hits.items(), key=lambda kv: kv[1][-1] if kv[1] else 0.0)
            for k, _ in by_age[: len(self._hits) - MAX_TRACKED_KEYS]:
                del self._hits[k]

    def _check_locked(self, key: str, rule: RateLimit, now: float) -> bool:
        hits = self._prune(key, now - rule.window)
        allowed = len(hits) < rule.limit
        if not hits:
            self._hits.pop(key, None)  # don't leave an empty bucket behind
        return allowed

    def _record_locked(self, key: str, rule: RateLimit, now: float) -> None:
        self._prune(key, now - rule.window).append(now)
        self._ops += 1
        # Sweep periodically to reclaim expired buckets, and immediately whenever
        # the table is over budget so the cap is a hard bound rather than one
        # that holds only between sweeps.
        if self._ops % _SWEEP_EVERY == 0 or len(self._hits) > MAX_TRACKED_KEYS:
            self._sweep(now)

    def check(self, key: str, rule: RateLimit, now: float | None = None) -> bool:
        """True when `key` is still under its limit. Does not consume budget."""
        now = time.monotonic() if now is None else now
        with self._lock:
            return self._check_locked(key, rule, now)

    def record(self, key: str, rule: RateLimit, now: float | None = None) -> None:
        """Consume one unit of `key`'s budget."""
        now = time.monotonic() if now is None else now
        with self._lock:
            self._record_locked(key, rule, now)

    def allow(self, key: str, rule: RateLimit, now: float | None = None) -> bool:
        """Check and consume atomically. False when the limit is already reached."""
        now = time.monotonic() if now is None else now
        with self._lock:
            if not self._check_locked(key, rule, now):
                return False
            self._record_locked(key, rule, now)
            return True

    def forget(self, key: str) -> None:
        """Drop `key`'s history — a successful login clears its failure streak."""
        with self._lock:
            self._hits.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
            self._ops = 0

    def tracked_keys(self) -> int:
        """Number of live buckets — exposed so tests can assert we don't leak."""
        with self._lock:
            return len(self._hits)


limiter = SlidingWindowLimiter()


def client_ip(request) -> str:
    """Best-effort client identity for rate-limit bucketing.

    ``X-Forwarded-For`` is only consulted when ``BALU_TRUSTED_PROXY_HOPS`` says
    how many proxies sit in front — the header is otherwise entirely
    attacker-controlled and every request could claim a fresh bucket.

    We count from the **right**. Proxies append: nginx's
    ``$proxy_add_x_forwarded_for``, Caddy and Traefik all produce
    ``"<whatever the client sent>, <peer address>"``. So the leftmost entry is
    still the client's own text — reading it would have made the header spoofable
    again in exactly the deployment the setting exists for. With one trusted hop
    the last entry is the address that hop observed, which is the real client.
    """
    hops = get_settings().trusted_proxy_hops
    if hops > 0:
        parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",")]
        parts = [p for p in parts if p]
        if len(parts) >= hops:
            return parts[-hops]
        # Fewer entries than configured: the chain isn't what we were told, so
        # fall through to the socket peer rather than trust a short header.
    client = getattr(request, "client", None)
    return client.host if client is not None else "unknown"
