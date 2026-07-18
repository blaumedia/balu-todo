"""Sync engine core: version stamping, sync-token codec, incremental pull."""

from __future__ import annotations

import base64
import uuid
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..models import Comment, Label, Membership, Project, Section, Task, User
from .serialize import (
    serialize_comment,
    serialize_label,
    serialize_member,
    serialize_project,
    serialize_section,
    serialize_task,
)

ROLE_RANK = {"viewer": 0, "member": 1, "admin": 2, "owner": 3}


# ---------------------------------------------------------------------------
# Version stamping
# ---------------------------------------------------------------------------
def bump_version(session: Session, workspace_id: uuid.UUID) -> int:
    """Atomically increment the workspace version counter and return the new value.

    The UPDATE ... RETURNING also row-locks the workspace, serialising concurrent
    command application per workspace.
    """
    row = session.execute(
        text("UPDATE workspaces SET version = version + 1 WHERE id = :w RETURNING version"),
        {"w": workspace_id},
    ).one()
    return int(row[0])


# ---------------------------------------------------------------------------
# Sync-token codec  (opaque base64 of "v:<int>")
# ---------------------------------------------------------------------------
def encode_token(version: int) -> str:
    return base64.urlsafe_b64encode(f"v:{version}".encode()).decode()


def decode_token(token: str) -> int | None:
    """Return the version encoded in `token`, or None for a full sync.

    "*" and any unparseable/garbage token both yield None (full sync).
    """
    if token == "*" or not token:
        return None
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
    except Exception:
        return None
    if not raw.startswith("v:"):
        return None
    try:
        return int(raw[2:])
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Incremental pull
# ---------------------------------------------------------------------------
def collect_changes(
    session: Session, workspace_id: uuid.UUID, since: int | None
) -> dict[str, list[dict[str, Any]]]:
    """Gather changed objects. `since is None` => full sync (live objects only)."""
    full = since is None

    def fetch(model):
        stmt = select(model).where(model.workspace_id == workspace_id)
        if full:
            stmt = stmt.where(model.is_deleted.is_(False))
        else:
            stmt = stmt.where(model.version > since)
        return session.execute(stmt).scalars().all()

    projects = [serialize_project(p) for p in fetch(Project)]
    sections = [serialize_section(s) for s in fetch(Section)]
    tasks = [serialize_task(t) for t in fetch(Task)]
    labels = [serialize_label(label) for label in fetch(Label)]
    comments = [serialize_comment(c) for c in fetch(Comment)]

    mstmt = select(Membership, User).join(User, User.id == Membership.user_id).where(
        Membership.workspace_id == workspace_id
    )
    if full:
        mstmt = mstmt.where(Membership.is_deleted.is_(False))
    else:
        mstmt = mstmt.where(Membership.version > since)
    members = [serialize_member(m, u) for m, u in session.execute(mstmt).all()]

    return {
        "projects": projects,
        "sections": sections,
        "tasks": tasks,
        "labels": labels,
        "comments": comments,
        "members": members,
    }


def current_version(session: Session, workspace_id: uuid.UUID) -> int:
    row = session.execute(
        text("SELECT version FROM workspaces WHERE id = :w"), {"w": workspace_id}
    ).one_or_none()
    return int(row[0]) if row else 0
