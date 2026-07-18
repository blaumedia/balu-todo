"""Workspace REST endpoints (create/update/delete)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

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
    db.delete(workspace)  # hard delete; FK cascades remove contents
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
