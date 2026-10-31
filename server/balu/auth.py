"""Authentication: password hashing, JWT access tokens, refresh-token rotation,
and the current-user dependency.
"""

from __future__ import annotations

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
def issue_refresh_token(
    db: Session, user_id: uuid.UUID, family_id: uuid.UUID | None = None
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
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:f, 0))"),
        {"f": str(family_id)},
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

    Replay of an already-rotated token invalidates the whole session family.
    """
    row = _find_refresh_token(db, raw)
    if row is None:
        raise invalid_token()
    # Two refreshes presenting one token both read it unrevoked and both issued
    # a live successor, which defeats the replay defence (§1); under the family
    # lock the second is judged a replay.
    _lock_family(db, row.family_id)
    row = _find_refresh_token(db, raw, fresh=True)
    if row is None:
        raise invalid_token()

    now = datetime.now(UTC)
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)

    if row.revoked:
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
