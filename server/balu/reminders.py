"""Reminder delivery (§8).

``reminder_tick`` is the unit of work: it finds due, un-sent, open reminders,
delivers them to the recipient's channels, and stamps ``reminder_sent_at`` so
they never re-fire (changing ``reminder_at`` clears the stamp — see commands).
The transport is injectable (``sender``) so tests can pass a fake.

Sent-state is server-internal and never appears in sync payloads.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_sessionmaker
from .delivery import Sender, deliver_to_user, task_context
from .models import Task
from .notifications import send_to_channel

logger = logging.getLogger("balu.reminders")


def build_message(session: Session, task: Task) -> tuple[str, str]:
    """(title, body) for a task reminder: title, then project name + deadline."""
    return task.title, task_context(session, task)


def deliver_reminder(session: Session, task: Task, sender: Sender) -> None:
    """Deliver one task's reminder to the recipient's channels.

    Recipient = assigned_to ?? created_by. Per-channel failures are logged and
    swallowed (no retry storm in v1); the caller still marks the reminder sent.
    """
    recipient_id = task.assigned_to or task.created_by
    if recipient_id is None:
        return
    title, body = build_message(session, task)
    deliver_to_user(session, sender, recipient_id, title, body)


def reminder_tick(
    session: Session,
    now: datetime | None = None,
    sender: Sender = send_to_channel,
) -> int:
    """Deliver all due reminders once. Returns the number of tasks processed."""
    now = now or datetime.now(UTC)
    tasks = (
        session.execute(
            select(Task).where(
                Task.reminder_at.is_not(None),
                Task.reminder_at <= now,
                Task.reminder_sent_at.is_(None),
                Task.completed_at.is_(None),
                Task.is_deleted.is_(False),
            )
        )
        .scalars()
        .all()
    )
    for task in tasks:
        deliver_reminder(session, task, sender)
        task.reminder_sent_at = now
    if tasks:
        session.commit()
    return len(tasks)


async def reminder_loop(stop_event: asyncio.Event) -> None:
    """Background loop: run reminder_tick every ``reminder_interval`` seconds."""
    settings = get_settings()
    interval = settings.reminder_interval
    sm = get_sessionmaker()
    while not stop_event.is_set():
        try:
            with sm() as session:
                reminder_tick(session)
        except Exception as exc:  # noqa: BLE001 - never let the loop die
            logger.warning("reminder tick failed: %s", exc)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except TimeoutError:
            pass
