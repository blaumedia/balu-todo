"""Serialize model rows into contract-shaped JSON dicts."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from ..models import Membership, Project, Section, Task, User


def iso_dt(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    value = value.astimezone(UTC)
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_date(value: date | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def serialize_project(p: Project) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "workspace_id": str(p.workspace_id),
        "name": p.name,
        "color": p.color,
        "sort_order": p.sort_order,
        "archived_at": iso_dt(p.archived_at),
        "created_at": iso_dt(p.created_at),
        "updated_at": iso_dt(p.updated_at),
        "is_deleted": p.is_deleted,
    }


def serialize_section(s: Section) -> dict[str, Any]:
    return {
        "id": str(s.id),
        "workspace_id": str(s.workspace_id),
        "project_id": str(s.project_id),
        "name": s.name,
        "sort_order": s.sort_order,
        "created_at": iso_dt(s.created_at),
        "updated_at": iso_dt(s.updated_at),
        "is_deleted": s.is_deleted,
    }


def serialize_task(t: Task) -> dict[str, Any]:
    return {
        "id": str(t.id),
        "workspace_id": str(t.workspace_id),
        "project_id": str(t.project_id) if t.project_id else None,
        "section_id": str(t.section_id) if t.section_id else None,
        "parent_task_id": str(t.parent_task_id) if t.parent_task_id else None,
        "title": t.title,
        "notes": t.notes,
        "start_date": iso_date(t.start_date),
        "evening": t.evening,
        "someday": t.someday,
        "deadline": iso_date(t.deadline),
        "reminder_at": iso_dt(t.reminder_at),
        "recurrence": t.recurrence,
        "priority": t.priority,
        "label_ids": [str(label.id) for label in t.labels],
        "assigned_to": str(t.assigned_to) if t.assigned_to else None,
        "sort_order": t.sort_order,
        "completed_at": iso_dt(t.completed_at),
        "completed_by": str(t.completed_by) if t.completed_by else None,
        "created_by": str(t.created_by) if t.created_by else None,
        "created_at": iso_dt(t.created_at),
        "updated_at": iso_dt(t.updated_at),
        "is_deleted": t.is_deleted,
    }


def serialize_label(label) -> dict[str, Any]:
    return {
        "id": str(label.id),
        "workspace_id": str(label.workspace_id),
        "name": label.name,
        "color": label.color,
        "sort_order": label.sort_order,
        "created_at": iso_dt(label.created_at),
        "updated_at": iso_dt(label.updated_at),
        "is_deleted": label.is_deleted,
    }


def serialize_member(m: Membership, user: User) -> dict[str, Any]:
    return {
        "id": str(m.user_id),
        "workspace_id": str(m.workspace_id),
        "name": user.name,
        "email": user.email,
        "role": m.role,
        "created_at": iso_dt(m.created_at),
        "updated_at": iso_dt(m.updated_at),
        "is_deleted": m.is_deleted,
    }
