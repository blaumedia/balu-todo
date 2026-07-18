"""Invite endpoints (§7): create / list / revoke, plus accept.

The token is a capability stored hashed (sha256, like refresh tokens); the
plaintext is returned only from the create call.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..errors import forbidden, invalid_invite_token, not_found
from ..models import Invite, Membership, User, Workspace
from ..schemas.invite import (
    InviteAccept,
    InviteCreate,
    InviteCreateResponse,
    InviteOut,
    InvitesResponse,
)
from ..schemas.workspace import AcceptInviteResponse, WorkspaceOut
from ..sync.engine import ROLE_RANK, bump_version
from .workspaces import _parse_ws_id, get_membership

router = APIRouter(tags=["invites"])

INVITE_TTL = timedelta(days=14)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _require_admin(db: Session, ws_id: uuid.UUID, user: User) -> Membership:
    membership = get_membership(db, ws_id, user.id)
    if ROLE_RANK.get(membership.role, 0) < ROLE_RANK["admin"]:
        raise forbidden("admin role required")
    return membership


def _invite_out(invite: Invite, token: str | None = None) -> InviteOut:
    return InviteOut(
        id=str(invite.id),
        workspace_id=str(invite.workspace_id),
        role=invite.role,
        email=invite.email,
        token=token,
        created_at=invite.created_at,
        expires_at=invite.expires_at,
    )


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


@router.post(
    "/workspaces/{workspace_id}/invites",
    status_code=status.HTTP_201_CREATED,
    response_model=InviteCreateResponse,
)
def create_invite(
    workspace_id: str,
    body: InviteCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InviteCreateResponse:
    ws_id = _parse_ws_id(workspace_id)
    _require_admin(db, ws_id, user)
    raw = secrets.token_urlsafe(32)
    invite = Invite(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        role=body.role,
        email=str(body.email) if body.email else None,
        token_hash=_hash_token(raw),
        revoked=False,
        expires_at=datetime.now(UTC) + INVITE_TTL,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return InviteCreateResponse(invite=_invite_out(invite, token=raw))


@router.get("/workspaces/{workspace_id}/invites", response_model=InvitesResponse)
def list_invites(
    workspace_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InvitesResponse:
    ws_id = _parse_ws_id(workspace_id)
    _require_admin(db, ws_id, user)
    now = datetime.now(UTC)
    rows = (
        db.execute(
            select(Invite).where(
                Invite.workspace_id == ws_id,
                Invite.revoked.is_(False),
                Invite.expires_at > now,
            )
        )
        .scalars()
        .all()
    )
    return InvitesResponse(invites=[_invite_out(i) for i in rows])


@router.delete(
    "/workspaces/{workspace_id}/invites/{invite_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def revoke_invite(
    workspace_id: str,
    invite_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    ws_id = _parse_ws_id(workspace_id)
    _require_admin(db, ws_id, user)
    try:
        inv_id = uuid.UUID(invite_id)
    except ValueError:
        raise not_found("invite not found") from None
    invite = db.get(Invite, inv_id)
    if invite is None or invite.workspace_id != ws_id:
        raise not_found("invite not found")
    invite.revoked = True
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/invites/accept", response_model=AcceptInviteResponse)
def accept_invite(
    body: InviteAccept,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AcceptInviteResponse:
    if not body.token:
        raise invalid_invite_token()

    invite = db.execute(
        select(Invite).where(Invite.token_hash == _hash_token(body.token))
    ).scalar_one_or_none()
    if invite is None or invite.revoked or _aware(invite.expires_at) <= datetime.now(UTC):
        raise invalid_invite_token()

    workspace = db.get(Workspace, invite.workspace_id)
    if workspace is None:
        raise invalid_invite_token()

    membership = db.get(
        Membership, {"workspace_id": invite.workspace_id, "user_id": user.id}
    )
    if membership is not None and not membership.is_deleted:
        # Already a member: idempotent success (role is not downgraded).
        return AcceptInviteResponse(
            workspace=WorkspaceOut(
                id=str(workspace.id), name=workspace.name, created_at=workspace.created_at
            )
        )

    version = bump_version(db, invite.workspace_id)
    if membership is None:
        membership = Membership(
            workspace_id=invite.workspace_id,
            user_id=user.id,
            role=invite.role,
            version=version,
        )
        db.add(membership)
    else:
        # Previously removed: re-activate with the invite's role.
        membership.is_deleted = False
        membership.role = invite.role
        membership.version = version
    db.commit()
    return AcceptInviteResponse(
        workspace=WorkspaceOut(
            id=str(workspace.id), name=workspace.name, created_at=workspace.created_at
        )
    )
