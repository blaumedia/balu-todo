"""Opaque capability tokens (refresh tokens §1, invite tokens §7).

Both are random urlsafe strings stored as a sha256 hex digest; only the hash ever
touches the database. One implementation instead of a copy per module (D8).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

#: 32 bytes of entropy, urlsafe-encoded (contract §1: "256 bit").
TOKEN_BYTES = 32


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def token_matches(raw: str, stored_hash: str) -> bool:
    """Constant-time comparison, for the paths that compare rather than look up."""
    return hmac.compare_digest(hash_token(raw), stored_hash)
