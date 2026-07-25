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
    if not limiter.allow(f"{bucket}:{key}", rule):
        raise rate_limited()


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
    workspace_name = body.name.strip() or body.name
    create_workspace_with_owner(db, workspace_name, user.id)

    access = create_access_token(user.id)
    refresh = issue_refresh_token(db, user.id)
    db.commit()
    return AuthResponse(user=user_out(user), access_token=access, refresh_token=refresh)


@router.post("/login", response_model=AuthResponse)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)) -> AuthResponse:
    email = body.email.lower()
    _throttle("login:ip", client_ip(request), LOGIN_PER_IP)
    _throttle("login:account", email, LOGIN_PER_ACCOUNT)

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        # Spend the same argon2 cost as a real verification: returning early here
        # made response time a registered-vs-unregistered oracle (S5).
        spend_verify_cost(body.password)
        raise invalid_credentials()
    if not verify_password(body.password, user.password_hash):
        raise invalid_credentials()
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
