"""Shared notification plumbing (§8).

Reminders (`balu.reminders`) and events (`balu.events`) both need the same two
things: the "Project: … / Due: …" context lines for a task, and the "load the
recipient's channels, send, log-and-swallow per channel" loop. They used to carry
a copy each, which drifted (one formatted the deadline with `isoformat()`, the
other via `iso_date`). One implementation lives here.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Project, Task, UserChannel
from .sync.serialize import iso_date

logger = logging.getLogger("balu.delivery")

#: ``send(channel_type, config, title, body)`` — injectable so tests pass a fake.
Sender = Callable[[str, dict[str, Any], str, str], None]


def user_channels(session: Session, user_id: Any) -> list[UserChannel]:
    return list(
        session.execute(select(UserChannel).where(UserChannel.user_id == user_id))
        .scalars()
        .all()
    )


def task_context(session: Session, task: Task) -> str:
    """Project name + deadline lines — the shared notification body for a task."""
    lines: list[str] = []
    if task.project_id is not None:
        project = session.get(Project, task.project_id)
        if project is not None and not project.is_deleted:
            lines.append(f"Project: {project.name}")
    if task.deadline is not None:
        lines.append(f"Due: {iso_date(task.deadline)}")
    return "\n".join(lines)


def deliver_to_user(
    session: Session, sender: Sender, user_id: Any, title: str, body: str
) -> int:
    """Send one message to every channel of one user.

    Per-channel failures are logged and swallowed — a notification must never
    fail the command or the reminder tick that triggered it. Returns the number
    of channels attempted.
    """
    channels = user_channels(session, user_id)
    for channel in channels:
        try:
            sender(channel.type, channel.config, title, body)
        except Exception as exc:  # noqa: BLE001 - log and continue, never propagate
            logger.warning(
                "delivery failed for user=%s channel=%s: %s", user_id, channel.type, exc
            )
    return len(channels)
