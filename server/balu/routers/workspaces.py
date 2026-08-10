"""Workspace REST endpoints (create/update/delete)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..attachments import remove_workspace_blobs
from ..auth import get_current_user
from ..db import get_db
from ..errors import forbidden, not_found, validation_error
from ..models import Membership, User, Workspace
from ..schemas.workspace import WorkspaceCreate, WorkspaceOut, WorkspaceUpdate
from ..services import create_workspace_with_owner
from ..sync.engine import ROLE_RANK

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _parse_ws_id(workspace_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(workspace_id)
    except ValueError:
        raise not_found("workspace not found") from None


def get_membership(db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID) -> Membership:
    m = db.get(Membership, {"workspace_id": workspace_id, "user_id": user_id})
    if m is None:
        # Never a member: don't reveal whether the workspace exists.
        raise not_found("workspace not found")
    if m.is_deleted:
        # Removed member: access is revoked immediately (§7).
        raise forbidden("you are no longer a member of this workspace")
    return m


@router.post("", status_code=status.HTTP_201_CREATED, response_model=WorkspaceOut)
def create_workspace(
    body: WorkspaceCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WorkspaceOut:
    workspace = create_workspace_with_owner(db, body.name, user.id)
    db.commit()
    db.refresh(workspace)
    return WorkspaceOut(id=str(workspace.id), name=workspace.name, created_at=workspace.created_at)


@router.patch("/{workspace_id}", response_model=WorkspaceOut)
def update_workspace(
    workspace_id: str,
    body: WorkspaceUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WorkspaceOut:
    ws_id = _parse_ws_id(workspace_id)
    membership = get_membership(db, ws_id, user.id)
    if ROLE_RANK.get(membership.role, 0) < ROLE_RANK["admin"]:
        raise forbidden("admin role required")
    workspace = db.get(Workspace, ws_id)
    if workspace is None:
        raise not_found("workspace not found")
    if not body.name.strip():
        raise validation_error("name is required")
    workspace.name = body.name
    db.commit()
    db.refresh(workspace)
    return WorkspaceOut(id=str(workspace.id), name=workspace.name, created_at=workspace.created_at)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(
    workspace_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    ws_id = _parse_ws_id(workspace_id)
    membership = get_membership(db, ws_id, user.id)
    if ROLE_RANK.get(membership.role, 0) < ROLE_RANK["owner"]:
        raise forbidden("owner role required")
    workspace = db.get(Workspace, ws_id)
    if workspace is None:
        raise not_found("workspace not found")

    # Everyone who is about to lose this workspace - not just the deleter. An
    # owner tearing down a shared workspace must not strand a member at zero
    # workspaces either, so the rescue below runs for every live member.
    member_ids = list(
        db.execute(
            select(Membership.user_id).where(
                Membership.workspace_id == ws_id,
                Membership.is_deleted.is_(False),
            )
        ).scalars()
    )

    db.delete(workspace)  # hard delete; FK cascades remove contents
    db.flush()

    # An account without a workspace has nowhere to land on the next boot, so
    # anyone left at zero gets a fresh default - named exactly as registration
    # names it (balu/routers/auth.py).
    for member_id in member_ids:
        remaining = db.execute(
            select(func.count())
            .select_from(Membership)
            .where(Membership.user_id == member_id, Membership.is_deleted.is_(False))
        ).scalar_one()
        if remaining:
            continue
        member = db.get(User, member_id)
        if member is None:
            continue
        create_workspace_with_owner(db, member.name.strip() or "My workspace", member_id)

    db.commit()

    # The rows went with the FK cascade; the blobs are on a filesystem that
    # knows nothing about it. Best-effort and after the commit - a failure here
    # leaks bytes, whereas doing it first would delete a live workspace's files
    # if the commit then failed.
    remove_workspace_blobs(ws_id)

    return Response(status_code=status.HTTP_204_NO_CONTENT)
