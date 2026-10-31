"""Authentication: password hashing, JWT access tokens, refresh-token rotation,
and the current-user dependency.
"""

from __future__ import annotations

import threading
import time
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, Request
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .errors import invalid_credentials, invalid_token, token_expired
from .models import RefreshToken, User
from .tokens import hash_token, new_token

_ph = PasswordHasher()
ALGORITHM = "HS256"


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


# Precomputed at import: hashing on first use made the very first
# unknown-email login measurably slower than a verify, which is the exact
# signal this path exists to remove.
_DUMMY_HASH = _ph.hash("balu-unregistered-account-placeholder")


def _dummy_hash() -> str:
    return _DUMMY_HASH


def spend_verify_cost(password: str) -> None:
    """Burn one argon2 verification against a throwaway hash.

    Called on the "no such user" login path so an unregistered address costs the
    same wall-clock time as a registered one (no enumeration oracle).
    """
    verify_password(password, _dummy_hash())


# ---------------------------------------------------------------------------
# Access tokens (JWT)
# ---------------------------------------------------------------------------
def create_access_token(user_id: uuid.UUID) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_expire_minutes)).timestamp()),
        "type": "access",
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> uuid.UUID:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise token_expired() from exc
    except jwt.InvalidTokenError as exc:
        raise invalid_token() from exc
    if payload.get("type") != "access":
        raise invalid_token()
    try:
        return uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise invalid_token() from exc


# ---------------------------------------------------------------------------
# Refresh tokens (opaque, hashed, rotated, family-scoped)
# ---------------------------------------------------------------------------
# The reuse window (§1) must hand a second presentation of the predecessor the
# same successor, but only hashes are stored. The plaintext successor is kept in
# this process for the grace window, keyed by the hash of the token it replaced.
# Assumes one server process (the Dockerfile runs a single uvicorn worker). With
# several workers, or after a restart, a retry misses the cache and is judged a
# replay (family burned, the user logs in again): safe, only less friendly.
# Nothing derivable from the secret key or a database dump is ever a live token.
_SUCCESSOR_CACHE_MAX = 10_000
_successors: dict[str, tuple[str, float]] = {}
_successors_lock = threading.Lock()
_clock = time.monotonic


def _remember_successor(old_hash: str, successor_raw: str) -> None:
    now = _clock()
    expiry = now + get_settings().refresh_reuse_grace_seconds
    with _successors_lock:
        # Every entry has the same grace period, so insertion order is expiry
        # order: drop expired entries from the front only, never scan the cache.
        while _successors:
            oldest = next(iter(_successors))
            if _successors[oldest][1] > now:
                break
            del _successors[oldest]
        _successors.pop(old_hash, None)
        _successors[old_hash] = (successor_raw, expiry)
        while len(_successors) > _SUCCESSOR_CACHE_MAX:
            del _successors[next(iter(_successors))]


def _recall_successor(old_hash: str) -> str | None:
    with _successors_lock:
        entry = _successors.get(old_hash)
        if entry is None:
            return None
        if entry[1] <= _clock():
            del _successors[old_hash]
            return None
        return entry[0]


def issue_refresh_token(
    db: Session,
    user_id: uuid.UUID,
    family_id: uuid.UUID | None = None,
) -> str:
    settings = get_settings()
    raw = new_token()
    row = RefreshToken(
        id=uuid.uuid4(),
        user_id=user_id,
        family_id=family_id or uuid.uuid4(),
        token_hash=hash_token(raw),
        revoked=False,
        expires_at=datetime.now(UTC)
        + timedelta(days=settings.refresh_token_expire_days),
    )
    db.add(row)
    return raw


def _lock_family(db: Session, family_id: uuid.UUID) -> None:
    """Serialise every rotation, replay burn and logout of one token family.

    Row locks on the presented token were not enough: two replays of different
    stale tokens each locked their own row and then waited for the other's in
    the family-wide UPDATE (deadlock), and a replay burning the family could not
    see a successor a concurrent rotation was inserting, leaving it live. One
    transaction-scoped lock per family, taken before any family row is touched,
    removes both. Released at commit or rollback.
    """
    # The wait is for a sibling refresh only; a lock_timeout here would fail the
    # refresh and, client side, log the user out. Lift the timeout for the wait
    # and put the connection's value back for the rest of the transaction. The
    # single SELECT relies on Postgres evaluating its target list left to right
    # (true in practice, not documented).
    db.execute(
        text(
            "SELECT set_config('lock_timeout', '0', true), "
            "pg_advisory_xact_lock(hashtextextended(:f, 0)), "
            "set_config('lock_timeout', :prev, true)"
        ),
        {"f": str(family_id), "prev": db.execute(text("SHOW lock_timeout")).scalar_one()},
    )


def _find_refresh_token(db: Session, raw: str, fresh: bool = False) -> RefreshToken | None:
    stmt = select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw))
    if fresh:
        # Re-read after the family lock: the row may have been rotated or
        # revoked by the transaction that held it.
        stmt = stmt.execution_options(populate_existing=True)
    return db.execute(stmt).scalar_one_or_none()


def rotate_refresh_token(db: Session, raw: str) -> tuple[uuid.UUID, str]:
    """Validate `raw`, rotate it, return (user_id, new_raw_token).

    Replay of an already-rotated token invalidates the whole session family,
    except the immediate predecessor within `refresh_reuse_grace_seconds`.
    """
    row = _find_refresh_token(db, raw)
    if row is None:
        raise invalid_token()
    # Two refreshes presenting one token both read it unrevoked and both issued
    # a live successor, which defeats the replay defence (§1); under the family
    # lock the second sees the rotation and, within the reuse window, gets the
    # same successor.
    _lock_family(db, row.family_id)
    row = _find_refresh_token(db, raw, fresh=True)
    if row is None:
        raise invalid_token()

    now = datetime.now(UTC)
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)

    if row.revoked:
        # The immediate predecessor, re-presented within the reuse window of its
        # rotation (lost response, client timeout, two tabs): answer with the
        # same successor (from the in-process cache), which is still live.
        # Evaluated under the family lock, so it sees a rotation that just
        # committed.
        cached = _recall_successor(row.token_hash)
        successor = _find_refresh_token(db, cached, fresh=True) if cached else None
        if (
            cached is not None
            and successor is not None
            and successor.family_id == row.family_id
            and not successor.revoked
        ):
            rotated_at = successor.created_at
            if rotated_at.tzinfo is None:
                rotated_at = rotated_at.replace(tzinfo=UTC)
            successor_expiry = successor.expires_at
            if successor_expiry.tzinfo is None:
                successor_expiry = successor_expiry.replace(tzinfo=UTC)
            grace = timedelta(seconds=get_settings().refresh_reuse_grace_seconds)
            if now - rotated_at <= grace and successor_expiry > now:
                return row.user_id, cached
        # Replay detected: burn the whole family and persist it (the request's
        # error path would otherwise roll the burn back). The family lock makes
        # this UPDATE see any successor a concurrent rotation just committed.
        db.query(RefreshToken).filter(RefreshToken.family_id == row.family_id).update(
            {RefreshToken.revoked: True}
        )
        db.commit()
        raise invalid_token()

    if expires_at <= now:
        raise invalid_token()

    row.revoked = True
    new_raw = issue_refresh_token(db, row.user_id, family_id=row.family_id)
    _remember_successor(row.token_hash, new_raw)
    return row.user_id, new_raw


def revoke_refresh_token(db: Session, raw: str) -> None:
    """Log out: revoke the whole session family, not just the presented token.

    Revoking only the presented token would leave every earlier token of the same
    family usable, so a logout would not actually end the session.
    """
    row = _find_refresh_token(db, raw)
    if row is not None:
        _lock_family(db, row.family_id)
        db.query(RefreshToken).filter(RefreshToken.family_id == row.family_id).update(
            {RefreshToken.revoked: True}
        )


# ---------------------------------------------------------------------------
# Current-user dependency
# ---------------------------------------------------------------------------
def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    header = request.headers.get("Authorization", "")
    if not header.lower().startswith("bearer "):
        raise invalid_token()
    token = header[7:].strip()
    user_id = decode_access_token(token)
    user = db.get(User, user_id)
    if user is None:
        raise invalid_credentials()
    return user
