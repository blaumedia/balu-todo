"""Archived-project visibility: the server half of ``projects.ts`` in @balu/domain.

An archived project's tasks are out of sight everywhere except inside that
project (no smart list, count, search hit or reminder). A subtask without its
own ``project_id`` follows its parent, as in ``h_project_delete``.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ColumnElement, and_, exists, or_, select
from sqlalchemy.orm import Session, aliased

from .models import Project, Task


def archived_project_ids(session: Session, workspace_id: uuid.UUID) -> list[uuid.UUID]:
    """Ids of the workspace's archived (not deleted) projects."""
    stmt = select(Project.id).where(
        Project.workspace_id == workspace_id,
        Project.is_deleted.is_(False),
        Project.archived_at.is_not(None),
    )
    return list(session.execute(stmt).scalars().all())


def effective_project_id(session: Session, task: Task) -> uuid.UUID | None:
    """The project a task sits in: its own, or its parent's for a subtask without one."""
    if task.project_id is not None:
        return task.project_id
    if task.parent_task_id is None:
        return None
    parent = session.get(Task, task.parent_task_id)
    return parent.project_id if parent is not None else None


def is_in_archived_project(session: Session, task: Task) -> bool:
    project_id = effective_project_id(session, task)
    if project_id is None:
        return False
    project = session.get(Project, project_id)
    return project is not None and not project.is_deleted and project.archived_at is not None


def outside_archived_projects(archived_ids: list[uuid.UUID]) -> ColumnElement[bool]:
    """SQL predicate on ``Task``: not in any of ``archived_ids``, resolving a subtask
    without its own project through its parent. Written positively (NOT IN plus an
    explicit NULL branch) so a NULL ``project_id`` never drops out by accident.
    Only meaningful with a non-empty list; callers skip it otherwise.
    """
    parent = aliased(Task)
    parent_archived = exists(
        select(parent.id).where(
            parent.id == Task.parent_task_id, parent.project_id.in_(archived_ids)
        )
    )
    return or_(
        Task.project_id.not_in(archived_ids),
        and_(Task.project_id.is_(None), ~parent_archived),
    )
