"""Authentication endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import (
    create_access_token,
    hash_password,
    issue_refresh_token,
    revoke_refresh_token,
    rotate_refresh_token,
    spend_verify_cost,
    verify_password,
)
from ..config import get_settings
from ..db import get_db
from ..errors import email_taken, invalid_credentials, rate_limited, registration_disabled
from ..models import User
from ..ratelimit import (
    LOGIN_PER_ACCOUNT,
    LOGIN_PER_IP,
    REFRESH_PER_IP,
    REGISTER_PER_IP,
    RateLimit,
    client_ip,
    limiter,
)
from ..schemas.auth import AuthResponse, LoginIn, LogoutIn, RefreshIn, RegisterIn, TokenPair
from ..schemas.user import user_out
from ..services import create_workspace_with_owner

router = APIRouter(prefix="/auth", tags=["auth"])


def _throttle(bucket: str, key: str, rule: RateLimit) -> None:
    """Count this attempt and reject once the bucket is full."""
    if not limiter.allow(f"{bucket}:{key}", rule):
        # Retry-After from the rule that actually rejected — registration's window
        # is an hour, so a fixed 300 would have told clients to retry far too soon.
        raise rate_limited(retry_after=int(rule.window))


def _failure_streak(email: str) -> str:
    return f"login:account:{email}"


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=AuthResponse)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)) -> AuthResponse:
    settings = get_settings()
    if not settings.allow_registration:
        raise registration_disabled()
    _throttle("register:ip", client_ip(request), REGISTER_PER_IP)

    existing = db.execute(
        select(User).where(User.email == body.email.lower())
    ).scalar_one_or_none()
    if existing is not None:
        raise email_taken()

    user = User(
        email=body.email.lower(),
        name=body.name,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.flush()

    # The workspace is named after the account, in full — splitting on the first
    # space turned "Anna Maria Schmidt" into a workspace called "Anna" (I12).
    workspace_name = body.name.strip() or "My workspace"
    create_workspace_with_owner(db, workspace_name, user.id)

    access = create_access_token(user.id)
    refresh = issue_refresh_token(db, user.id)
    db.commit()
    return AuthResponse(user=user_out(user), access_token=access, refresh_token=refresh)


@router.post("/login", response_model=AuthResponse)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)) -> AuthResponse:
    email = body.email.lower()
    # The per-IP bucket is the flood control: it counts every attempt and is what
    # caps how much argon2 work one caller can force.
    _throttle("login:ip", client_ip(request), LOGIN_PER_IP)

    # The per-account bucket tracks *consecutive failures*, and is consulted only
    # after verification. Rejecting a full bucket up front (the first cut) meant
    # anyone who knew an address could lock its owner out for the whole window
    # with 8 wrong guesses — the attacker's failures denied the real user. Here a
    # correct password always gets through and clears the streak; a wrong one is
    # recorded and, once the streak is over the limit, answered with 429.
    streak = _failure_streak(email)
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()

    if user is None:
        # Spend the same argon2 cost as a real verification: returning early here
        # made response time a registered-vs-unregistered oracle (S5).
        spend_verify_cost(body.password)
        over_limit = not limiter.allow(streak, LOGIN_PER_ACCOUNT)
        raise (
            rate_limited(retry_after=int(LOGIN_PER_ACCOUNT.window))
            if over_limit
            else invalid_credentials()
        )

    if not verify_password(body.password, user.password_hash):
        over_limit = not limiter.allow(streak, LOGIN_PER_ACCOUNT)
        raise (
            rate_limited(retry_after=int(LOGIN_PER_ACCOUNT.window))
            if over_limit
            else invalid_credentials()
        )

    limiter.forget(streak)
    access = create_access_token(user.id)
    refresh = issue_refresh_token(db, user.id)
    db.commit()
    return AuthResponse(user=user_out(user), access_token=access, refresh_token=refresh)


@router.post("/refresh", response_model=TokenPair)
def refresh(body: RefreshIn, request: Request, db: Session = Depends(get_db)) -> TokenPair:
    _throttle("refresh:ip", client_ip(request), REFRESH_PER_IP)
    user_id, new_refresh = rotate_refresh_token(db, body.refresh_token)
    access = create_access_token(user_id)
    db.commit()
    return TokenPair(access_token=access, refresh_token=new_refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(body: LogoutIn, db: Session = Depends(get_db)) -> Response:
    revoke_refresh_token(db, body.refresh_token)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
