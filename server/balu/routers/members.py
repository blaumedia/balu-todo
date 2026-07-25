"""Member management endpoints (§7): change role / remove (or leave).

Membership mutations bump the workspace version and stamp the member row so the
change travels through sync (removal surfaces as a member with is_deleted=true).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import ObjectDeletedError

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


def _refresh_or_gone(db: Session, membership: Membership) -> None:
    """Re-read a membership under the lock, or 404 if it vanished.

    `DELETE /workspaces/{id}` hard-deletes with FK cascades, so a member
    operation queued behind one finds its row cascaded away; an unguarded
    `refresh` then raises ObjectDeletedError and the caller sees a 500 for a
    workspace that simply no longer exists.
    """
    try:
        db.refresh(membership)
    except ObjectDeletedError:
        raise not_found("workspace not found") from None


def _lock_workspace(db: Session, ws_id: uuid.UUID) -> None:
    """Serialise membership mutations for one workspace.

    Without this the last-owner guard is a check-then-act across two
    transactions: two owners removing each other concurrently both count 2, both
    pass the `<= 1` check, and both commit — different rows, so nothing
    conflicts — leaving a workspace with zero owners. Nobody can then grant
    `owner` (that requires being one), so it is permanently ungovernable.
    """
    db.execute(text("SELECT id FROM workspaces WHERE id = :w FOR UPDATE"), {"w": ws_id})


def _owner_count(db: Session, ws_id: uuid.UUID) -> int:
    """Live owners. Callers must hold {@link _lock_workspace} first."""
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
    if target is None:
        raise not_found("member not found")
    # `db.get` serves the identity map without touching the database, and for a
    # self-targeted call the row was already loaded by `get_membership` *before*
    # the workspace lock. Refresh first, then judge: checking `is_deleted` on the
    # stale copy let a request racing a concurrent removal write a role onto an
    # already-deleted membership and return 200 for a member that no longer exists.
    _refresh_or_gone(db, target)
    if target.is_deleted:
        raise not_found("member not found")
    return target


def _rank(role: str) -> int:
    return ROLE_RANK.get(role, 0)


def _check_can_act_on(actor: Membership, target: Membership) -> None:
    """§7: you may not act on a member ranked *above* you.

    This is what stops an admin demoting a sitting owner (promotion to owner is
    gated separately, on the actor being an owner). Peers may act on each other:
    forbidding that made a co-owner impossible to remove through the API — only
    they could step down — which is a worse failure than admin infighting, and
    the last-owner guard still keeps every workspace governable.
    """
    if _rank(actor.role) < _rank(target.role):
        raise forbidden("cannot act on a member of higher rank")


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

    # Lock and re-read *before* judging anything. Gating on the pre-lock snapshot
    # left a window as wide as the lock wait: an owner being demoted could keep
    # passing the "owner may grant owner" gate, queue on the lock, and then
    # promote someone the moment their own demotion committed — an admin granting
    # `owner`, which the gate exists to forbid.
    _lock_workspace(db, ws_id)
    _refresh_or_gone(db, actor)
    if actor.is_deleted:
        raise forbidden("you are no longer a member of this workspace")
    if _rank(actor.role) < ROLE_RANK["admin"]:
        raise forbidden("admin role required")
    # Only an owner may hand out (or take away) the owner role.
    if body.role == "owner" and actor.role != "owner":
        raise forbidden("owner role required to grant owner")

    target = _get_target(db, ws_id, target_id)
    # Changing your own role is always allowed (handing over ownership, stepping
    # down); the last-owner guard below is what keeps a workspace governable.
    if target_id != user.id:
        _check_can_act_on(actor, target)
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

    # Same ordering as update_member_role: lock, re-read, then judge. A demoted
    # or removed actor must not still be acting on the strength of the rank they
    # held when the request arrived.
    _lock_workspace(db, ws_id)
    _refresh_or_gone(db, actor)
    if actor.is_deleted:
        raise forbidden("you are no longer a member of this workspace")
    if not is_self and _rank(actor.role) < ROLE_RANK["admin"]:
        raise forbidden("admin role or self required")

    target = _get_target(db, ws_id, target_id)
    if not is_self:
        _check_can_act_on(actor, target)
    # Removing the last owner (incl. self-leave as last owner) is forbidden.
    if target.role == "owner" and _owner_count(db, ws_id) <= 1:
        raise last_owner()

    version = bump_version(db, ws_id)
    target.is_deleted = True
    target.version = version
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
