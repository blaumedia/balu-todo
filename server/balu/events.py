"""Event notifications (§8, v1.2): assignment + comment.

Fire-and-forget: a command handler records lightweight event descriptors on its
``Ctx`` while it runs; after the command's transaction commits, the orchestrator
calls :func:`dispatch_events` which builds messages from the now-durable rows and
delivers them through each recipient's channels. Every failure (a bad channel, a
missing row, an unexpected error) is logged and swallowed — notifications must
never affect ``sync_status`` or fail a command.

The transport is injectable (``sender``) so tests pass a fake; the sync router
supplies the real :func:`~balu.notifications.send_to_channel` via
:func:`get_event_sender`.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from .delivery import Sender, deliver_to_user, task_context
from .models import Comment, Task, User
from .notifications import send_to_channel

logger = logging.getLogger("balu.events")

#: Alias kept for the existing call sites / dependency override.
EventSender = Sender


# ---------------------------------------------------------------------------
# Event descriptors (recorded by handlers, dispatched post-commit)
# ---------------------------------------------------------------------------
@dataclass
class AssignmentEvent:
    task_id: uuid.UUID
    assignee_id: uuid.UUID


@dataclass
class CommentEvent:
    task_id: uuid.UUID
    comment_id: uuid.UUID


Event = AssignmentEvent | CommentEvent


# ---------------------------------------------------------------------------
# FastAPI dependency (overridable in tests)
# ---------------------------------------------------------------------------
def get_event_sender() -> EventSender:
    return send_to_channel


# ---------------------------------------------------------------------------
# Delivery helpers  (the loop and the body live in balu.delivery — D9)
# ---------------------------------------------------------------------------
def _deliver_assignment(
    session: Session, sender: EventSender, actor_name: str, event: AssignmentEvent
) -> None:
    task = session.get(Task, event.task_id)
    if task is None or task.is_deleted:
        return
    title = f"{actor_name} assigned you: {task.title}"
    deliver_to_user(session, sender, event.assignee_id, title, task_context(session, task))


def _comment_recipients(
    session: Session, task: Task, comment: Comment
) -> set[uuid.UUID]:
    """Participants of a task: assignee, creator, and prior comment authors."""
    recipients: set[uuid.UUID] = set()
    if task.assigned_to is not None:
        recipients.add(task.assigned_to)
    if task.created_by is not None:
        recipients.add(task.created_by)
    author_rows = (
        session.execute(
            select(Comment.author_id).where(
                Comment.task_id == task.id,
                Comment.is_deleted.is_(False),
                Comment.id != comment.id,
            )
        )
        .scalars()
        .all()
    )
    for author_id in author_rows:
        if author_id is not None:
            recipients.add(author_id)
    # Never notify the actor about their own comment.
    if comment.author_id is not None:
        recipients.discard(comment.author_id)
    return recipients


def _deliver_comment(
    session: Session, sender: EventSender, actor_name: str, event: CommentEvent
) -> None:
    comment = session.get(Comment, event.comment_id)
    if comment is None or comment.is_deleted:
        return
    task = session.get(Task, event.task_id)
    if task is None:
        return
    title = f"{actor_name} commented on: {task.title}"
    for recipient_id in _comment_recipients(session, task, comment):
        deliver_to_user(session, sender, recipient_id, title, comment.body)


# ---------------------------------------------------------------------------
# Dispatch (post-commit, per command)
# ---------------------------------------------------------------------------
def dispatch_events(
    sm: sessionmaker[Session],
    actor_id: uuid.UUID,
    events: list[Event],
    sender: EventSender = send_to_channel,
) -> None:
    """Deliver all events recorded by a committed command. Never raises."""
    if not events:
        return
    try:
        with sm() as session:
            actor = session.get(User, actor_id)
            actor_name = actor.name if actor is not None else "Someone"
            for event in events:
                try:
                    if isinstance(event, AssignmentEvent):
                        _deliver_assignment(session, sender, actor_name, event)
                    elif isinstance(event, CommentEvent):
                        _deliver_comment(session, sender, actor_name, event)
                except Exception as exc:  # noqa: BLE001 - one bad event never blocks the rest
                    logger.warning("event dispatch failed: %s", exc)
    except Exception as exc:  # noqa: BLE001 - notifications must never fail a command
        logger.warning("event dispatch session failed: %s", exc)
