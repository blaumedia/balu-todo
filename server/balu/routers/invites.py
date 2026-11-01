"""Invite endpoints (§7): create / list / revoke, plus accept.

The token is a capability stored hashed (sha256, like refresh tokens); the
plaintext is returned only from the create call.
"""

from __future__ import annotations

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
from ..services import fresh_membership, lock_workspace, require_member_under_lock
from ..sync.engine import ROLE_RANK, bump_version
from ..tokens import hash_token, new_token
from .workspaces import _parse_ws_id, get_membership

router = APIRouter(tags=["invites"])

INVITE_TTL = timedelta(days=14)


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


def _invite_usable(invite: Invite, user: User) -> bool:
    if invite.revoked or _aware(invite.expires_at) <= datetime.now(UTC):
        return False
    # An invite addressed to someone specific only admits that someone (§7).
    # Untargeted invites (no email) stay open to anyone holding the link.
    return not (invite.email and invite.email.lower() != user.email.lower())


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
    # An admin demoted while waiting must not mint invites; a create racing a
    # workspace delete is a 404, not an FK error.
    require_member_under_lock(db, ws_id, user.id, "admin", "admin role required")
    raw = new_token()
    invite = Invite(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        role=body.role,
        email=str(body.email) if body.email else None,
        token_hash=hash_token(raw),
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
    # Without the lock an accept could not be ordered against the revoke.
    require_member_under_lock(db, ws_id, user.id, "admin", "admin role required")
    invite = db.get(Invite, inv_id, populate_existing=True)
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
        select(Invite).where(Invite.token_hash == hash_token(body.token))
    ).scalar_one_or_none()
    # Cheap pre-check: garbage, revoked or foreign tokens never touch the lock.
    if invite is None or not _invite_usable(invite, user):
        raise invalid_invite_token()
    invite_id, ws_id = invite.id, invite.workspace_id

    # Lock, then judge again (members.py). A revoke, a workspace delete or a
    # second accept by the same user that committed while this one waited must
    # be seen: judging the pre-lock reads let a revoked invite admit a member,
    # let a delete strand the new member without a workspace, and let a double
    # accept insert a duplicate membership (IntegrityError, a 500).
    if not lock_workspace(db, ws_id):
        raise invalid_invite_token()
    invite = db.execute(
        select(Invite).where(Invite.id == invite_id).execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if invite is None or not _invite_usable(invite, user):
        raise invalid_invite_token()
    workspace = db.get(Workspace, ws_id, populate_existing=True)
    if workspace is None:
        raise invalid_invite_token()

    membership = fresh_membership(db, ws_id, user.id)
    if membership is not None and not membership.is_deleted:
        # Already a member (including by a concurrent accept of the same user):
        # idempotent success, role is not downgraded (§7).
        return AcceptInviteResponse(
            workspace=WorkspaceOut(
                id=str(workspace.id), name=workspace.name, created_at=workspace.created_at
            )
        )

    version = bump_version(db, ws_id)
    if membership is None:
        membership = Membership(
            workspace_id=ws_id,
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
