"""In-process sliding-window rate limiting for the auth endpoints (§1).

Balu is a single-container self-hosted app, so an in-memory limiter is the right
size: no extra dependency, no shared state to operate. It is per-process — if you
ever run several app workers, put the real limit in the reverse proxy as well.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass


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


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, rule: RateLimit, now: float | None = None) -> bool:
        """Record an attempt for `key`. False when the limit is already reached."""
        now = time.monotonic() if now is None else now
        hits = self._hits[key]
        cutoff = now - rule.window
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= rule.limit:
            return False
        hits.append(now)
        return True

    def reset(self) -> None:
        self._hits.clear()


limiter = SlidingWindowLimiter()


def client_ip(request) -> str:
    """Best-effort client identity. Behind a proxy, trust the first XFF hop."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = getattr(request, "client", None)
    return client.host if client is not None else "unknown"
