"""Shared service helpers used by REST routers."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from .models import Membership, Workspace
from .sync.engine import bump_version


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
