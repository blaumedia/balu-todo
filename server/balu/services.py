"""Shared service helpers used by REST routers."""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .errors import forbidden, not_found
from .models import Membership, User, Workspace
from .sync.engine import ROLE_RANK, bump_version


def create_workspace_with_owner(db: Session, name: str, user_id: uuid.UUID) -> Workspace:
    """Create a workspace and its owner membership, stamping the member version."""
    workspace = Workspace(id=uuid.uuid4(), name=name)
    db.add(workspace)
    db.flush()  # assign id and initial version=0
    version = bump_version(db, workspace.id)
    membership = Membership(
        workspace_id=workspace.id,
        user_id=user_id,
        role="owner",
        version=version,
    )
    db.add(membership)
    db.flush()
    return workspace


def lock_workspace(db: Session, workspace_id: uuid.UUID) -> bool:
    """Take the workspace row lock that serialises every mutation of one workspace.

    A lock that conflicts with the one `bump_version` takes (this one is the
    stronger FOR UPDATE, which also blocks foreign-key KEY SHARE). Returns False
    when the row is gone: deleted before the call, or deleted by the transaction
    this one waited for (under READ COMMITTED a FOR UPDATE that waited re-reads
    the row, and a deleted row returns nothing).
    """
    return (
        db.execute(
            text("SELECT id FROM workspaces WHERE id = :w FOR UPDATE"), {"w": workspace_id}
        ).first()
        is not None
    )


def fresh_membership(
    db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> Membership | None:
    """Read a membership from the database, never from the identity map.

    `db.get` returns the copy loaded before the lock without a query, and judging
    that stale copy is the check-then-act this module exists to prevent.
    """
    return db.execute(
        select(Membership)
        .where(Membership.workspace_id == workspace_id, Membership.user_id == user_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def require_member_under_lock(
    db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID, min_role: str, message: str
) -> Membership:
    """Lock the workspace, re-read the caller's membership and judge it.

    Routers keep their cheap pre-lock check (non-members never contend for the
    lock); this is the authoritative one. A caller removed, demoted, or whose
    workspace was deleted while the request waited is refused here.
    """
    if not lock_workspace(db, workspace_id):
        raise not_found("workspace not found")
    membership = fresh_membership(db, workspace_id, user_id)
    if membership is None:
        raise not_found("workspace not found")
    if membership.is_deleted:
        raise forbidden("you are no longer a member of this workspace")
    if ROLE_RANK.get(membership.role, 0) < ROLE_RANK[min_role]:
        raise forbidden(message)
    return membership


def lock_users(db: Session, user_ids: Iterable[uuid.UUID]) -> None:
    """Row-lock user rows (FOR NO KEY UPDATE, in id order).

    Serialises the per-account invariants that span workspaces: "every account
    keeps at least one workspace" (counted across all of a user's memberships)
    and the user's channel list. Take it after the workspace lock, never before.
    NO KEY UPDATE does not conflict with the KEY SHARE lock a foreign-key insert
    takes, so accepts, commands and token issuance never wait on it.
    """
    ids = sorted(set(user_ids))
    if not ids:
        return
    db.execute(
        select(User.id).where(User.id.in_(ids)).order_by(User.id).with_for_update(key_share=True)
    ).all()


def rescue_if_workspaceless(db: Session, user_id: uuid.UUID) -> Workspace | None:
    """Give an account that just lost its last workspace a fresh default one.

    An account without a workspace has nowhere to land on the next boot (§2).
    The name follows registration (balu/routers/auth.py). Callers hold
    `lock_users` for `user_id` and have flushed the change that removed the
    membership, so the count sees their own change and every committed one.
    """
    remaining = db.execute(
        select(func.count())
        .select_from(Membership)
        .where(Membership.user_id == user_id, Membership.is_deleted.is_(False))
    ).scalar_one()
    if remaining:
        return None
    member = db.get(User, user_id)
    if member is None:
        return None
    return create_workspace_with_owner(db, member.name.strip() or "My workspace", user_id)
