"""Member management endpoints (§7): change role / remove (or leave).

Membership mutations bump the workspace version and stamp the member row so the
change travels through sync (removal surfaces as a member with is_deleted=true).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..errors import forbidden, last_owner, not_found
from ..models import Membership, User
from ..schemas.invite import MemberRoleUpdate
from ..sync.engine import ROLE_RANK, bump_version
from ..sync.serialize import serialize_member
from .workspaces import _parse_ws_id, get_membership

router = APIRouter(prefix="/workspaces", tags=["members"])


def _parse_user_id(user_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(user_id)
    except ValueError:
        raise not_found("member not found") from None


def _owner_count(db: Session, ws_id: uuid.UUID) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(Membership)
            .where(
                Membership.workspace_id == ws_id,
                Membership.role == "owner",
                Membership.is_deleted.is_(False),
            )
        ).scalar_one()
    )


def _get_target(db: Session, ws_id: uuid.UUID, target_id: uuid.UUID) -> Membership:
    target = db.get(Membership, {"workspace_id": ws_id, "user_id": target_id})
    if target is None or target.is_deleted:
        raise not_found("member not found")
    return target


@router.patch("/{workspace_id}/members/{user_id}")
def update_member_role(
    workspace_id: str,
    user_id: str,
    body: MemberRoleUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    ws_id = _parse_ws_id(workspace_id)
    target_id = _parse_user_id(user_id)
    actor = get_membership(db, ws_id, user.id)
    if ROLE_RANK.get(actor.role, 0) < ROLE_RANK["admin"]:
        raise forbidden("admin role required")

    target = _get_target(db, ws_id, target_id)
    # Demoting the last owner is forbidden.
    if target.role == "owner" and body.role != "owner" and _owner_count(db, ws_id) <= 1:
        raise last_owner()

    version = bump_version(db, ws_id)
    target.role = body.role
    target.version = version
    db.commit()
    db.refresh(target)
    target_user = db.get(User, target_id)
    return serialize_member(target, target_user)


@router.delete("/{workspace_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    workspace_id: str,
    user_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    ws_id = _parse_ws_id(workspace_id)
    target_id = _parse_user_id(user_id)
    actor = get_membership(db, ws_id, user.id)

    is_self = target_id == user.id
    if not is_self and ROLE_RANK.get(actor.role, 0) < ROLE_RANK["admin"]:
        raise forbidden("admin role or self required")

    target = _get_target(db, ws_id, target_id)
    # Removing the last owner (incl. self-leave as last owner) is forbidden.
    if target.role == "owner" and _owner_count(db, ws_id) <= 1:
        raise last_owner()

    version = bump_version(db, ws_id)
    target.is_deleted = True
    target.version = version
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
