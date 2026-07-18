"""Authentication endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import (
    create_access_token,
    hash_password,
    issue_refresh_token,
    revoke_refresh_token,
    rotate_refresh_token,
    verify_password,
)
from ..config import get_settings
from ..db import get_db
from ..errors import email_taken, invalid_credentials, registration_disabled
from ..models import User
from ..schemas.auth import AuthResponse, LoginIn, LogoutIn, RefreshIn, RegisterIn, TokenPair
from ..schemas.user import UserOut
from ..services import create_workspace_with_owner

router = APIRouter(prefix="/auth", tags=["auth"])


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=str(user.id),
        email=user.email,
        name=user.name,
        locale=user.locale,
        theme=user.theme,
        created_at=user.created_at,
    )


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=AuthResponse)
def register(body: RegisterIn, db: Session = Depends(get_db)) -> AuthResponse:
    settings = get_settings()
    if not settings.allow_registration:
        raise registration_disabled()

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

    workspace_name = body.name.split()[0] if body.name.strip() else body.name
    create_workspace_with_owner(db, workspace_name, user.id)

    access = create_access_token(user.id)
    refresh = issue_refresh_token(db, user.id)
    db.commit()
    return AuthResponse(user=_user_out(user), access_token=access, refresh_token=refresh)


@router.post("/login", response_model=AuthResponse)
def login(body: LoginIn, db: Session = Depends(get_db)) -> AuthResponse:
    user = db.execute(
        select(User).where(User.email == body.email.lower())
    ).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise invalid_credentials()
    access = create_access_token(user.id)
    refresh = issue_refresh_token(db, user.id)
    db.commit()
    return AuthResponse(user=_user_out(user), access_token=access, refresh_token=refresh)


@router.post("/refresh", response_model=TokenPair)
def refresh(body: RefreshIn, db: Session = Depends(get_db)) -> TokenPair:
    user_id, new_refresh = rotate_refresh_token(db, body.refresh_token)
    access = create_access_token(user_id)
    db.commit()
    return TokenPair(access_token=access, refresh_token=new_refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(body: LogoutIn, db: Session = Depends(get_db)) -> Response:
    revoke_refresh_token(db, body.refresh_token)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
