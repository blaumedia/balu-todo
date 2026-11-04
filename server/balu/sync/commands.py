"""Command handlers and the per-request orchestrator.

Each command runs in its own transaction (its own Session). A failure records an
error status and does not abort the remaining commands. The uuids of successfully
applied commands are persisted for idempotent replay; a rejected command is not
remembered and is evaluated again when re-sent (contract §5.1); temp_id -> object_id
mappings persist across requests.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import NoResultFound, StatementError
from sqlalchemy.orm import Session, sessionmaker

from ..attachments import remove_blob
from ..db import describe_transient_error, is_transient_db_error
from ..events import (
    AssignmentEvent,
    CommentEvent,
    Event,
    EventSender,
    dispatch_events,
)
from ..models import (
    Attachment,
    Comment,
    Label,
    Membership,
    Project,
    Section,
    SyncedCommand,
    Task,
    TempIdMap,
    task_labels,
)
from ..notifications import send_to_channel
from .engine import ROLE_RANK, bump_version
from .recurrence import parse_recurrence, roll_forward, utc_offset_minutes

logger = logging.getLogger("balu.sync.commands")

VALID_COLORS = {
    "slate", "red", "orange", "amber", "green", "teal",
    "cyan", "blue", "indigo", "violet", "pink", "rose",
}

# Keys within command args that may carry an id or temp_id reference.
_REF_KEYS = ("id", "project_id", "section_id", "parent_task_id", "task_id")

# Text limits (S15). `title` matches its String(1000) column; `notes` is a Text
# column, so without a cap any member could write arbitrarily large rows.
MAX_TITLE = 1000
MAX_NAME = 200
MAX_NOTES = 20_000
MAX_BODY = 5000


class CommandError(Exception):
    def __init__(self, code: str, message: str = "") -> None:
        self.code = code
        self.message = message or code
        super().__init__(self.message)


@dataclass
class Ctx:
    session: Session
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    role: str
    temp_map: dict[str, str]  # in-request + persisted temp_id resolution cache
    events: list[Event] = field(default_factory=list)  # fire-and-forget, dispatched post-commit
    # (workspace, attachment) blobs to remove once the commit succeeded
    blob_deletions: list[tuple[uuid.UUID, uuid.UUID]] = field(default_factory=list)

    # Memoised: process_commands bumps before the handler runs, so the workspace
    # row lock is taken before any other lock or lookup; the handler's own call
    # then returns the same version (one bump per command).
    _version: int | None = field(default=None, init=False, repr=False)

    def bump(self) -> int:
        if self._version is None:
            self._version = bump_version(self.session, self.workspace_id)
        return self._version


# ---------------------------------------------------------------------------
# Small parsing / validation helpers
# ---------------------------------------------------------------------------
def _as_uuid(value: Any) -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise CommandError("not_found", f"unknown reference: {value!r}") from exc


_INT32_MAX = 2**31 - 1
_INT32_MIN = -(2**31)


def _sort_order(value: Any) -> int:
    """Parse a client sort_order into what the Integer column can hold.

    Out of range used to reach Postgres as a DataError, whose logged text carried
    the bound parameters (task titles and notes). It is clamped instead of rejected:
    the clients append with max + 1000 without a cap, so once a container sits at
    the int32 maximum every offline add would otherwise be thrown away.
    """
    # The clients only send JSON numbers. bool is an int subclass, floats would be
    # truncated and strings are not sent, so all of those are rejected.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CommandError("invalid_args", "sort_order must be an integer")
    if isinstance(value, float) and not value.is_integer():  # also inf and NaN
        raise CommandError("invalid_args", "sort_order must be an integer")
    return max(_INT32_MIN, min(int(value), _INT32_MAX))


def _require_str(args: dict, key: str, max_length: int = MAX_NAME) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip():
        raise CommandError("invalid_args", f"{key} is required")
    if len(value) > max_length:
        raise CommandError(
            "invalid_args", f"{key} must be at most {max_length} characters"
        )
    return value


def _optional_text(args: dict, key: str, max_length: int) -> str:
    value = args.get(key)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise CommandError("invalid_args", f"{key} must be a string or null")
    if len(value) > max_length:
        raise CommandError(
            "invalid_args", f"{key} must be at most {max_length} characters"
        )
    return value


def _require_body(args: dict) -> str:
    return _require_str(args, "body", MAX_BODY)


def _parse_date(value: Any, key: str) -> date | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise CommandError("invalid_args", f"{key} must be YYYY-MM-DD") from exc


def _parse_dt(value: Any, key: str) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError as exc:
        raise CommandError("invalid_args", f"{key} must be an ISO 8601 datetime") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _validate_color(value: Any) -> str:
    if value not in VALID_COLORS:
        raise CommandError("invalid_args", f"invalid color: {value!r}")
    return value


def _validate_priority(value: Any) -> int:
    if value not in (0, 1, 2, 3):
        raise CommandError("invalid_args", f"invalid priority: {value!r}")
    return value


def _validate_recurrence(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise CommandError("invalid_args", "recurrence must be a string or null")
    if len(value) > 200:  # matches tasks.recurrence String(200)
        raise CommandError("invalid_args", "recurrence must be at most 200 characters")
    try:
        parse_recurrence(value)
    except ValueError as exc:
        raise CommandError("invalid_args", f"invalid recurrence: {exc}") from exc
    return value


def _max_sort_order(ctx: Ctx, model, **filters) -> int:
    # MAX in the database (I14): this used to pull every sibling's sort_order
    # into Python just to take the maximum.
    stmt = select(func.max(model.sort_order)).where(model.workspace_id == ctx.workspace_id)
    for key, value in filters.items():
        col = getattr(model, key)
        stmt = stmt.where(col.is_(None) if value is None else col == value)
    stmt = stmt.where(model.is_deleted.is_(False))
    highest = ctx.session.execute(stmt).scalar()
    # Capped so an automatic sort order (a relocated offline add included) stays
    # within the int32 column.
    return min((highest or 0) + 1000, _INT32_MAX)


# ---------------------------------------------------------------------------
# Object getters (live objects only; deleted -> not_found)
# ---------------------------------------------------------------------------
def _get_project(ctx: Ctx, ref: Any) -> Project:
    obj = ctx.session.get(Project, _as_uuid(ref))
    if obj is None or obj.is_deleted or obj.workspace_id != ctx.workspace_id:
        raise CommandError("not_found", "project not found")
    return obj


def _get_section(ctx: Ctx, ref: Any) -> Section:
    obj = ctx.session.get(Section, _as_uuid(ref))
    if obj is None or obj.is_deleted or obj.workspace_id != ctx.workspace_id:
        raise CommandError("not_found", "section not found")
    return obj


def _get_task(ctx: Ctx, ref: Any) -> Task:
    obj = ctx.session.get(Task, _as_uuid(ref))
    if obj is None or obj.is_deleted or obj.workspace_id != ctx.workspace_id:
        raise CommandError("not_found", "task not found")
    return obj


def _get_label(ctx: Ctx, ref: Any) -> Label:
    obj = ctx.session.get(Label, _as_uuid(ref))
    if obj is None or obj.is_deleted or obj.workspace_id != ctx.workspace_id:
        raise CommandError("not_found", "label not found")
    return obj


def _get_comment(ctx: Ctx, ref: Any) -> Comment:
    obj = ctx.session.get(Comment, _as_uuid(ref))
    if obj is None or obj.is_deleted or obj.workspace_id != ctx.workspace_id:
        raise CommandError("not_found", "comment not found")
    return obj


def _get_attachment(ctx: Ctx, ref: Any) -> Attachment:
    obj = ctx.session.get(Attachment, _as_uuid(ref))
    if obj is None or obj.is_deleted or obj.workspace_id != ctx.workspace_id:
        raise CommandError("not_found", "attachment not found")
    return obj


# ---------------------------------------------------------------------------
# Deleted-tolerant getter (task_add placement fallback only)
# ---------------------------------------------------------------------------
def _get_including_deleted[M: (Project, Section, Task)](
    ctx: Ctx, model: type[M], ref: Any, what: str
) -> M:
    """Like the getters above, but a soft-deleted row is returned instead of raising.

    Only for task_add's placement fallback (contract §5.5): every other caller must
    keep treating a deleted object as not_found. Unknown ids and other workspaces
    are still not_found.

    Races with a concurrent project_delete are closed by the caller bumping the
    workspace version before any lookup (process_commands takes the lock), not by a row lock here.
    """
    obj = ctx.session.get(model, _as_uuid(ref))
    if obj is None or obj.workspace_id != ctx.workspace_id:
        raise CommandError("not_found", f"{what} not found")
    return obj


def _is_member(ctx: Ctx, user_id: uuid.UUID) -> bool:
    m = ctx.session.get(Membership, {"workspace_id": ctx.workspace_id, "user_id": user_id})
    return m is not None and not m.is_deleted


def _resolve_labels(ctx: Ctx, label_ids: Any) -> list[Label]:
    if not isinstance(label_ids, list):
        raise CommandError("invalid_args", "label_ids must be a list")
    labels: list[Label] = []
    for ref in label_ids:
        labels.append(_get_label(ctx, ref))
    return labels


# ---------------------------------------------------------------------------
# Task field application (shared by task_add / task_update)
# ---------------------------------------------------------------------------
def _check_section_in_project(section: Section, project_id: uuid.UUID | None) -> None:
    """A task's section must live in the task's own project (I4)."""
    if section.project_id != project_id:
        raise CommandError(
            "invalid_args", "section_id must belong to the task's project"
        )


def _apply_task_fields(ctx: Ctx, task: Task, args: dict) -> None:
    if "title" in args:
        task.title = _require_str(args, "title", MAX_TITLE)
    if "notes" in args:
        task.notes = _optional_text(args, "notes", MAX_NOTES)
    if "start_date" in args:
        task.start_date = _parse_date(args.get("start_date"), "start_date")
    if "evening" in args:
        task.evening = bool(args.get("evening"))
    if "someday" in args:
        task.someday = bool(args.get("someday"))
    if "deadline" in args:
        task.deadline = _parse_date(args.get("deadline"), "deadline")
    if "reminder_at" in args:
        task.reminder_at = _parse_dt(args.get("reminder_at"), "reminder_at")
        # Re-arm delivery: a changed/cleared reminder must be able to fire again.
        task.reminder_sent_at = None
    if "recurrence" in args:
        task.recurrence = _validate_recurrence(args.get("recurrence"))
    if "priority" in args:
        task.priority = _validate_priority(args.get("priority"))
    if "assigned_to" in args:
        assignee = args.get("assigned_to")
        if assignee is None:
            task.assigned_to = None
        else:
            uid = _as_uuid(assignee)
            if not _is_member(ctx, uid):
                raise CommandError("invalid_args", "assigned_to must be a workspace member")
            task.assigned_to = uid
    if "label_ids" in args:
        task.labels = _resolve_labels(ctx, args.get("label_ids"))

    # someday forces start_date null (mutually exclusive)
    if task.someday:
        task.start_date = None


def _record_assignment(ctx: Ctx, task: Task, previous: uuid.UUID | None) -> None:
    """Queue an assignment notification when a task is assigned to someone new (not self)."""
    new = task.assigned_to
    if new is not None and new != previous and new != ctx.user_id:
        ctx.events.append(AssignmentEvent(task_id=task.id, assignee_id=new))


def _check_parent(ctx: Ctx, parent_ref: Any) -> uuid.UUID | None:
    if parent_ref is None:
        return None
    parent = _get_task(ctx, parent_ref)
    if parent.parent_task_id is not None:
        raise CommandError("invalid_args", "subtasks may only nest one level")
    return parent.id


# ---------------------------------------------------------------------------
# Command handlers
# ---------------------------------------------------------------------------
def h_project_add(ctx: Ctx, args: dict) -> dict:
    name = _require_str(args, "name")
    color = _validate_color(args.get("color", "slate"))
    version = ctx.bump()
    sort_order = args.get("sort_order")
    if sort_order is None:
        sort_order = _max_sort_order(ctx, Project)
    project = Project(
        id=uuid.uuid4(),
        workspace_id=ctx.workspace_id,
        name=name,
        color=color,
        sort_order=_sort_order(sort_order),
        version=version,
    )
    ctx.session.add(project)
    return {"object_id": project.id}


def h_project_update(ctx: Ctx, args: dict) -> dict:
    project = _get_project(ctx, args.get("id"))
    if "name" in args:
        project.name = _require_str(args, "name")
    if "color" in args:
        project.color = _validate_color(args.get("color"))
    if "sort_order" in args:
        project.sort_order = _sort_order(args["sort_order"])
    if "archived_at" in args:
        project.archived_at = _parse_dt(args.get("archived_at"), "archived_at")
    project.version = ctx.bump()
    return {}


def h_project_delete(ctx: Ctx, args: dict) -> dict:
    project = _get_project(ctx, args.get("id"))
    version = ctx.bump()
    project.is_deleted = True
    project.version = version
    sections = ctx.session.execute(
        select(Section).where(
            Section.project_id == project.id, Section.is_deleted.is_(False)
        )
    ).scalars().all()
    for s in sections:
        s.is_deleted = True
        s.version = version
    tasks = ctx.session.execute(
        select(Task).where(Task.project_id == project.id, Task.is_deleted.is_(False))
    ).scalars().all()
    for t in tasks:
        t.is_deleted = True
        t.version = version

    # Subtasks inherit their parent's project in the UI but carry their own
    # `project_id`, which may be null — those would survive the query above and
    # be left pointing at a deleted parent.
    parent_ids = [t.id for t in tasks]
    orphans = ctx.session.execute(
        select(Task).where(
            Task.parent_task_id.in_(parent_ids), Task.is_deleted.is_(False)
        )
    ).scalars().all() if parent_ids else []
    for st in orphans:
        st.is_deleted = True
        st.version = version

    # Deleting a task cascades to its comments (§3.4) and attachments (§3.7) -
    # deleting the project that holds those tasks has to do the same, or they
    # stay live and keep syncing against tasks that no longer exist.
    dead_task_ids = parent_ids + [st.id for st in orphans]
    _delete_comments_of(ctx, dead_task_ids, version)
    _delete_attachments_of(ctx, dead_task_ids, version)
    return {}


def _delete_comments_of(ctx: Ctx, task_ids: list[uuid.UUID], version: int) -> None:
    if not task_ids:
        return
    comments = ctx.session.execute(
        select(Comment).where(
            Comment.task_id.in_(task_ids), Comment.is_deleted.is_(False)
        )
    ).scalars().all()
    for c in comments:
        c.is_deleted = True
        c.version = version


def _delete_attachments_of(ctx: Ctx, task_ids: list[uuid.UUID], version: int) -> None:
    """Soft-delete the tasks' attachments and queue their blobs for removal.

    The rows must stay (soft-deleted, version bumped) so clients learn to remove
    them locally, but the bytes have nothing left to belong to. The blobs go
    after the commit (process_commands), never inside the transaction.
    """
    if not task_ids:
        return
    attachments = ctx.session.execute(
        select(Attachment).where(
            Attachment.task_id.in_(task_ids), Attachment.is_deleted.is_(False)
        )
    ).scalars().all()
    for a in attachments:
        a.is_deleted = True
        a.version = version
        ctx.blob_deletions.append((a.workspace_id, a.id))


def h_section_add(ctx: Ctx, args: dict) -> dict:
    project = _get_project(ctx, args.get("project_id"))
    name = _require_str(args, "name")
    version = ctx.bump()
    sort_order = args.get("sort_order")
    if sort_order is None:
        sort_order = _max_sort_order(ctx, Section, project_id=project.id)
    section = Section(
        id=uuid.uuid4(),
        workspace_id=ctx.workspace_id,
        project_id=project.id,
        name=name,
        sort_order=_sort_order(sort_order),
        version=version,
    )
    ctx.session.add(section)
    return {"object_id": section.id}


def h_section_update(ctx: Ctx, args: dict) -> dict:
    section = _get_section(ctx, args.get("id"))
    if "name" in args:
        section.name = _require_str(args, "name")
    if "sort_order" in args:
        section.sort_order = _sort_order(args["sort_order"])
    section.version = ctx.bump()
    return {}


def h_section_delete(ctx: Ctx, args: dict) -> dict:
    section = _get_section(ctx, args.get("id"))
    version = ctx.bump()
    section.is_deleted = True
    section.version = version
    tasks = ctx.session.execute(
        select(Task).where(Task.section_id == section.id, Task.is_deleted.is_(False))
    ).scalars().all()
    for t in tasks:
        t.section_id = None
        t.version = version
    return {}


def h_task_add(ctx: Ctx, args: dict) -> dict:
    title = _require_str(args, "title", MAX_TITLE)
    # process_commands has already taken the workspace lock (ctx.bump() is memoised),
    # so every sync command is serialised against every other one. Under READ
    # COMMITTED the lookups below see a committed delete, and a delete waiting on
    # the lock sees our task in its cascade. Taking a project row lock before the
    # bump would instead deadlock against project_delete and project_update.
    version = ctx.bump()
    # An offline device can queue a task_add for a project, section or parent task a
    # teammate deleted before it synced. Rejecting it would throw the typed task away
    # (the client rolls back and full-syncs), so a deleted target is replaced by the
    # nearest live container instead (contract §5.5). Only *deleted* targets qualify:
    # unknown ids, other workspaces and I4 violations are still rejected (a
    # `section_id` is not checked at all when the requested project is deleted).
    relocated: list[str] = []

    # A live parent decides the container (contract §3.3): the sent project and
    # section are ignored, so they are neither looked up nor can they relocate.
    live_parent: Task | None = None
    parent_deleted = False
    if args.get("parent_task_id") is not None:
        parent = _get_including_deleted(ctx, Task, args["parent_task_id"], "task")
        if parent.is_deleted:
            parent_deleted = True
        else:
            _check_parent(ctx, parent.id)
            live_parent = parent

    project_id = None
    section_id = None
    parent_task_id = None
    if live_parent is not None:
        parent_task_id = live_parent.id
        project_id = live_parent.project_id
        section_id = live_parent.section_id
    else:
        requested_project_id = None
        if args.get("project_id") is not None:
            project = _get_including_deleted(ctx, Project, args["project_id"], "project")
            requested_project_id = project.id
            if project.is_deleted:
                relocated.append("project_deleted")
            else:
                project_id = project.id

        project_deleted = "project_deleted" in relocated
        if args.get("section_id") is not None and not project_deleted:
            section = _get_including_deleted(ctx, Section, args["section_id"], "section")
            _check_section_in_project(section, requested_project_id)  # raises with no project (I4)
            if section.is_deleted:
                relocated.append("section_deleted")
            else:
                section_id = section.id
        # With the project deleted the task goes to the Inbox whatever the section is, so
        # the section id is not looked up: it may be an unresolvable temp id whose
        # section_add failed because of that same deleted project.
    if parent_deleted:
        relocated.append("parent_deleted")

    task = Task(
        id=uuid.uuid4(),
        workspace_id=ctx.workspace_id,
        project_id=project_id,
        section_id=section_id,
        parent_task_id=parent_task_id,
        title=title,
        notes="",
        created_by=ctx.user_id,
        version=version,
    )
    _apply_task_fields(ctx, task, args)
    _record_assignment(ctx, task, previous=None)
    # The client computed sort_order for the container it asked for; appended to the
    # one it actually lands in instead.
    sort_order = None if relocated else args.get("sort_order")
    if sort_order is None:
        if parent_task_id is not None:
            sort_order = _max_sort_order(ctx, Task, parent_task_id=parent_task_id)
        else:
            sort_order = _max_sort_order(
                ctx, Task, project_id=project_id, section_id=section_id, parent_task_id=None
            )
    task.sort_order = _sort_order(sort_order)
    ctx.session.add(task)
    result: dict = {"object_id": task.id}
    if relocated:
        result["relocated"] = relocated
    return result


def h_task_update(ctx: Ctx, args: dict) -> dict:
    task = _get_task(ctx, args.get("id"))
    previous_assignee = task.assigned_to
    _apply_task_fields(ctx, task, args)
    _record_assignment(ctx, task, previous=previous_assignee)
    task.version = ctx.bump()
    return {}


def h_task_move(ctx: Ctx, args: dict) -> dict:
    task = _get_task(ctx, args.get("id"))
    if "parent_task_id" in args:
        new_parent_id = _check_parent(ctx, args.get("parent_task_id"))
        if new_parent_id is not None and new_parent_id == task.id:
            raise CommandError("invalid_args", "a task cannot be its own parent")
        if new_parent_id is not None and ctx.session.execute(
            select(Task.id).where(
                Task.parent_task_id == task.id, Task.is_deleted.is_(False)
            ).limit(1)
        ).first() is not None:
            raise CommandError(
                "invalid_args", "a task with subtasks cannot become a subtask"
            )
        task.parent_task_id = new_parent_id
    # A subtask's container is its parent's (applied below): a sent project_id or
    # section_id is ignored, not validated against the task's old project.
    is_subtask = task.parent_task_id is not None
    if "project_id" in args and not is_subtask:
        task.project_id = (
            _get_project(ctx, args["project_id"]).id if args.get("project_id") else None
        )
        # Moving to another project drops a section that no longer applies,
        # unless this same command sets a matching one.
        if "section_id" not in args:
            task.section_id = None
    if "section_id" in args and not is_subtask:
        if args.get("section_id"):
            section = _get_section(ctx, args["section_id"])
            _check_section_in_project(section, task.project_id)
            task.section_id = section.id
        else:
            task.section_id = None
    if "sort_order" in args:
        task.sort_order = _sort_order(args["sort_order"])
    version = ctx.bump()
    task.version = version
    if task.parent_task_id is not None:
        # Re-parented (or moved) subtask: it follows its parent's container.
        parent = _get_task(ctx, task.parent_task_id)
        task.project_id = parent.project_id
        task.section_id = parent.section_id
    else:
        _cascade_to_subtasks(ctx, task, version)
    return {}


def _cascade_to_subtasks(ctx: Ctx, parent: Task, version: int) -> None:
    """A subtask's project_id and section_id follow its parent (contract §3.3)."""
    subtasks = ctx.session.execute(
        select(Task).where(Task.parent_task_id == parent.id, Task.is_deleted.is_(False))
    ).scalars().all()
    for st in subtasks:
        if st.project_id != parent.project_id or st.section_id != parent.section_id:
            st.project_id = parent.project_id
            st.section_id = parent.section_id
            st.version = version


def _completion_today(args: dict) -> date:
    """The calendar day to roll a recurring task forward from.

    The client applies `task_complete` optimistically against its *local* day
    (contract §0), so deriving this from UTC alone made the two disagree for
    anyone far enough from UTC: at 09:00 on the 24th in UTC+13 the server still
    sees the 23rd, picks a different next occurrence, and the task visibly jumps
    when the response lands — the same symptom the anchoring fix removed, from a
    different cause.

    The client therefore sends its own day. It is clamped to ±1 day of UTC (the
    real range of world timezones) so a wrong or hostile value cannot push a
    series somewhere arbitrary.
    """
    utc_today = datetime.now(UTC).date()
    claimed = args.get("today")
    if claimed is None:
        return utc_today
    try:
        parsed = _parse_date(claimed, "today")
    except CommandError:
        # A hint, not an instruction: garbage falls back rather than failing the
        # completion (which on a current client would trigger a full resync).
        return utc_today
    if parsed is None or abs((parsed - utc_today).days) > 1:
        return utc_today
    return parsed


def h_task_complete(ctx: Ctx, args: dict) -> dict:
    task = _get_task(ctx, args.get("id"))
    version = ctx.bump()
    if task.recurrence:
        # Anchor on the task's own date so the rule keeps its phase (contract §3.3).
        rolled = roll_forward(
            task.recurrence,
            task.start_date,
            task.deadline,
            task.reminder_at,
            _completion_today(args),
            utc_offset_minutes(args.get("utc_offset")),
        )
        task.start_date = rolled.start_date
        task.deadline = rolled.deadline
        if rolled.reminder_at != task.reminder_at:
            task.reminder_at = rolled.reminder_at
            # Re-arm delivery for the next occurrence, as _apply_task_fields does.
            task.reminder_sent_at = None
        # recurring task stays open: completed_at intentionally left null
    else:
        task.completed_at = datetime.now(UTC)
        task.completed_by = ctx.user_id
    task.version = version
    return {}


def h_task_uncomplete(ctx: Ctx, args: dict) -> dict:
    task = _get_task(ctx, args.get("id"))
    task.completed_at = None
    task.completed_by = None
    task.version = ctx.bump()
    return {}


def h_task_delete(ctx: Ctx, args: dict) -> dict:
    task = _get_task(ctx, args.get("id"))
    version = ctx.bump()
    task.is_deleted = True
    task.version = version
    subtasks = ctx.session.execute(
        select(Task).where(Task.parent_task_id == task.id, Task.is_deleted.is_(False))
    ).scalars().all()
    for st in subtasks:
        st.is_deleted = True
        st.version = version
    # Cascade to comments (§3.4) and attachments (§3.7) of the task and its subtasks.
    dead_task_ids = [task.id, *(st.id for st in subtasks)]
    _delete_comments_of(ctx, dead_task_ids, version)
    _delete_attachments_of(ctx, dead_task_ids, version)
    return {}


def h_task_reorder(ctx: Ctx, args: dict) -> dict:
    items = args.get("items")
    if not isinstance(items, list) or not items:
        raise CommandError("invalid_args", "items must be a non-empty list")
    tasks: list[tuple[Task, int]] = []
    for item in items:
        if not isinstance(item, dict) or "id" not in item or "sort_order" not in item:
            raise CommandError("invalid_args", "each item needs id and sort_order")
        sort_order = _sort_order(item["sort_order"])
        try:
            task = _get_task(ctx, item["id"])
        except CommandError as exc:
            if exc.code != "not_found":
                raise
            # Deleted, unknown or foreign: skipped, so one stale id (a teammate deleted
            # the task meanwhile) does not void the whole reordering (contract §5.5).
            continue
        tasks.append((task, sort_order))
    if not tasks:
        return {}
    version = ctx.bump()
    for task, sort_order in tasks:
        task.sort_order = sort_order
        task.version = version
    return {}


def _label_name_exists(ctx: Ctx, name: str, exclude_id: uuid.UUID | None = None) -> bool:
    stmt = select(Label).where(
        Label.workspace_id == ctx.workspace_id,
        Label.is_deleted.is_(False),
        Label.name.ilike(name),
    )
    for existing in ctx.session.execute(stmt).scalars().all():
        if exclude_id is None or existing.id != exclude_id:
            return True
    return False


def h_label_add(ctx: Ctx, args: dict) -> dict:
    name = _require_str(args, "name")
    color = _validate_color(args.get("color", "slate"))
    if _label_name_exists(ctx, name):
        raise CommandError("name_taken", "a label with that name already exists")
    version = ctx.bump()
    sort_order = args.get("sort_order")
    if sort_order is None:
        sort_order = _max_sort_order(ctx, Label)
    label = Label(
        id=uuid.uuid4(),
        workspace_id=ctx.workspace_id,
        name=name,
        color=color,
        sort_order=_sort_order(sort_order),
        version=version,
    )
    ctx.session.add(label)
    return {"object_id": label.id}


def h_label_update(ctx: Ctx, args: dict) -> dict:
    label = _get_label(ctx, args.get("id"))
    if "name" in args:
        name = _require_str(args, "name")
        if _label_name_exists(ctx, name, exclude_id=label.id):
            raise CommandError("name_taken", "a label with that name already exists")
        label.name = name
    if "color" in args:
        label.color = _validate_color(args.get("color"))
    if "sort_order" in args:
        label.sort_order = _sort_order(args["sort_order"])
    label.version = ctx.bump()
    return {}


def h_label_delete(ctx: Ctx, args: dict) -> dict:
    label = _get_label(ctx, args.get("id"))
    version = ctx.bump()
    # Tasks currently carrying this label change (label_ids shrinks) -> bump them too.
    affected = ctx.session.execute(
        select(Task)
        .join(task_labels, task_labels.c.task_id == Task.id)
        .where(task_labels.c.label_id == label.id, Task.is_deleted.is_(False))
    ).scalars().all()
    ctx.session.execute(task_labels.delete().where(task_labels.c.label_id == label.id))
    for t in affected:
        t.version = version
    label.is_deleted = True
    label.version = version
    return {}


def h_comment_add(ctx: Ctx, args: dict) -> dict:
    task = _get_task(ctx, args.get("task_id"))
    body = _require_body(args)
    version = ctx.bump()
    comment = Comment(
        id=uuid.uuid4(),
        workspace_id=ctx.workspace_id,
        task_id=task.id,
        author_id=ctx.user_id,
        body=body,
        version=version,
    )
    ctx.session.add(comment)
    ctx.events.append(CommentEvent(task_id=task.id, comment_id=comment.id))
    return {"object_id": comment.id}


def h_comment_update(ctx: Ctx, args: dict) -> dict:
    comment = _get_comment(ctx, args.get("id"))
    if comment.author_id != ctx.user_id:
        raise CommandError("forbidden", "only the author can edit a comment")
    comment.body = _require_body(args)
    comment.version = ctx.bump()
    return {}


def h_comment_delete(ctx: Ctx, args: dict) -> dict:
    comment = _get_comment(ctx, args.get("id"))
    is_author = comment.author_id == ctx.user_id
    is_admin = ROLE_RANK.get(ctx.role, 0) >= ROLE_RANK["admin"]
    if not (is_author or is_admin):
        raise CommandError("forbidden", "only the author or an admin can delete a comment")
    comment.is_deleted = True
    comment.version = ctx.bump()
    return {}


def h_attachment_delete(ctx: Ctx, args: dict) -> dict:
    """Soft-delete an attachment; any writable role may remove any of them.

    Uploading is REST (§3.7) - there is no `attachment_add` command, so this is
    the only attachment mutation that travels the queue.
    """
    attachment = _get_attachment(ctx, args.get("id"))
    attachment.is_deleted = True
    attachment.version = ctx.bump()
    # After the commit (process_commands): a failed commit must not leave a live
    # row whose blob is gone (a broken attachment), whereas an orphaned blob after
    # a crash between commit and removal is only harmless leaked bytes.
    ctx.blob_deletions.append((attachment.workspace_id, attachment.id))
    return {}


HANDLERS: dict[str, Callable[[Ctx, dict], dict]] = {
    "project_add": h_project_add,
    "project_update": h_project_update,
    "project_delete": h_project_delete,
    "section_add": h_section_add,
    "section_update": h_section_update,
    "section_delete": h_section_delete,
    "task_add": h_task_add,
    "task_update": h_task_update,
    "task_move": h_task_move,
    "task_complete": h_task_complete,
    "task_uncomplete": h_task_uncomplete,
    "task_delete": h_task_delete,
    "task_reorder": h_task_reorder,
    "label_add": h_label_add,
    "label_update": h_label_update,
    "label_delete": h_label_delete,
    "comment_add": h_comment_add,
    "comment_update": h_comment_update,
    "comment_delete": h_comment_delete,
    "attachment_delete": h_attachment_delete,
}

_ADD_COMMANDS = {"project_add", "section_add", "task_add", "label_add", "comment_add"}


# ---------------------------------------------------------------------------
# temp_id resolution
# ---------------------------------------------------------------------------
def _resolve_ref(temp_map: dict[str, str], value: Any) -> Any:
    if isinstance(value, str) and value in temp_map:
        return temp_map[value]
    return value


def _resolve_args(temp_map: dict[str, str], args: dict) -> dict:
    resolved = dict(args)
    for key in _REF_KEYS:
        if key in resolved:
            resolved[key] = _resolve_ref(temp_map, resolved[key])
    if isinstance(resolved.get("label_ids"), list):
        resolved["label_ids"] = [_resolve_ref(temp_map, v) for v in resolved["label_ids"]]
    if isinstance(resolved.get("assigned_to"), str):
        resolved["assigned_to"] = _resolve_ref(temp_map, resolved["assigned_to"])
    if isinstance(resolved.get("items"), list):
        new_items = []
        for item in resolved["items"]:
            if isinstance(item, dict) and "id" in item:
                item = {**item, "id": _resolve_ref(temp_map, item["id"])}
            new_items.append(item)
        resolved["items"] = new_items
    return resolved


def _command_temp_ids(temp_id: str | None, args: dict) -> set[str]:
    """Every string a command could use as a temp_id: its own and its references."""
    names: list[Any] = [temp_id]
    names.extend(args.get(key) for key in _REF_KEYS)
    names.append(args.get("assigned_to"))
    if isinstance(args.get("label_ids"), list):
        names.extend(args["label_ids"])
    if isinstance(args.get("items"), list):
        names.extend(item.get("id") for item in args["items"] if isinstance(item, dict))
    return {n for n in names if isinstance(n, str)}


def _load_temp_map(
    session: Session, workspace_id: uuid.UUID, temp_ids: set[str]
) -> dict[str, str]:
    if not temp_ids:
        return {}
    rows = session.execute(
        select(TempIdMap.temp_id, TempIdMap.object_id).where(
            TempIdMap.workspace_id == workspace_id,
            TempIdMap.temp_id.in_(temp_ids),
        )
    ).all()
    return {temp_id: str(object_id) for temp_id, object_id in rows}


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
def _is_success(status_json: dict) -> bool:
    return status_json.get("status") == "ok"


def _replay(
    status_json: dict,
    cmd_uuid: str,
    sync_status: dict[str, Any],
    temp_map: dict[str, str],
    temp_id_mapping: dict[str, str],
    relocated: dict[str, Any] | None,
) -> None:
    """Report a stored success again: status, temp_id mapping and relocation."""
    sync_status[cmd_uuid] = status_json.get("status")
    stored_temp = status_json.get("temp_id")
    stored_obj = status_json.get("object_id")
    if stored_temp and stored_obj:
        temp_map[stored_temp] = stored_obj
        temp_id_mapping[stored_temp] = stored_obj
    stored_relocated = status_json.get("relocated")
    if stored_relocated and relocated is not None:
        relocated[cmd_uuid] = stored_relocated


class TransientDbError(Exception):
    """A temporary database failure while applying a command (retry the request)."""


def process_commands(
    sm: sessionmaker[Session],
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    role: str,
    commands: list,
    event_sender: EventSender = send_to_channel,
    relocated: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Apply commands in order, each in its own transaction.

    Returns (sync_status keyed by command uuid, temp_id_mapping).

    When `relocated` is given, it is filled with `{command uuid: {"reasons": [...]}}`
    for every task_add the server filed somewhere other than requested because its
    target was deleted (contract §5.5); a replay reports the stored entry again.

    `role` is the caller's role as the router read it before any lock. It is
    trusted only to deny: each command re-reads the membership under the
    workspace lock and uses that role.
    """
    sync_status: dict[str, Any] = {}
    temp_id_mapping: dict[str, str] = {}

    # Mappings known so far: filled per command under the workspace lock, and by
    # replays of stored successes.
    temp_map: dict[str, str] = {}

    for command in commands:
        cmd_uuid = command.uuid
        try:
            cmd_uuid_obj = uuid.UUID(str(cmd_uuid))
        except (ValueError, TypeError):
            sync_status[str(cmd_uuid)] = {
                "error_code": "invalid_args",
                "error": "uuid must be a UUID",
            }
            continue

        # Idempotent replay of a stored success: final, so it can be served
        # without the lock. The key is workspace-scoped - the same uuid in another
        # workspace is a new command. A stored rejection is not replayed: nothing
        # of it was committed, so the command is evaluated again against the
        # current state (it may succeed now, or fail the same way).
        with sm() as check_session:
            existing = check_session.get(
                SyncedCommand, {"workspace_id": workspace_id, "uuid": cmd_uuid_obj}
            )
            if existing is not None and _is_success(existing.status_json):
                _replay(
                    existing.status_json, str(cmd_uuid), sync_status, temp_map,
                    temp_id_mapping, relocated,
                )
                continue

        handler = HANDLERS.get(command.type)
        status: Any
        result: dict = {}
        object_id: str | None = None

        session = sm()
        try:
            # Fast reject before the lock: a viewer's batch must not take the
            # workspace row lock once per command. The router's role may be stale
            # (only ever a denial, as before v1.5.2); the authoritative check is
            # the one under the lock below.
            if ROLE_RANK.get(role, 0) < ROLE_RANK["member"]:
                raise CommandError("forbidden", "viewer role is read-only")
            if handler is None:
                raise CommandError("invalid_args", f"unknown command type: {command.type}")
            ctx = Ctx(
                session=session,
                workspace_id=workspace_id,
                user_id=user_id,
                role=role,
                temp_map=temp_map,
            )
            # Workspace lock first, before the handler reads or changes any row: a
            # handler that flushed a row change or checked a parent before its own
            # bump raced concurrent deletes and could deadlock against them.
            try:
                ctx.bump()
            except NoResultFound:
                # The workspace was deleted before or while this command waited
                # for its lock.
                raise CommandError("not_found", "workspace not found") from None
            # A request that held the lock first may have committed mappings this
            # command must see (reuse check, reference resolution): load the ones
            # it names, now that the lock is held.
            temp_map.update(
                _load_temp_map(
                    session,
                    workspace_id,
                    _command_temp_ids(command.temp_id, command.args or {}),
                )
            )
            # A concurrent request carrying the same uuid held the lock first;
            # without this both applied it and the loser reported "command could
            # not be applied".
            existing = session.get(
                SyncedCommand,
                {"workspace_id": workspace_id, "uuid": cmd_uuid_obj},
                populate_existing=True,
            )
            if existing is not None and _is_success(existing.status_json):
                session.rollback()
                _replay(
                    existing.status_json, str(cmd_uuid), sync_status, temp_map,
                    temp_id_mapping, relocated,
                )
                continue
            # The router's role predates the lock: a member removed or demoted
            # mid-batch keeps no write access, and `h_comment_delete` gates on
            # `ctx.role`.
            membership = session.get(
                Membership,
                {"workspace_id": workspace_id, "user_id": user_id},
                populate_existing=True,
            )
            if membership is None or membership.is_deleted:
                raise CommandError("forbidden", "you are no longer a member of this workspace")
            if ROLE_RANK.get(membership.role, 0) < ROLE_RANK["member"]:
                raise CommandError("forbidden", "viewer role is read-only")
            ctx.role = membership.role
            # A temp_id names exactly one object per workspace, forever (§5.3).
            # Reusing one for a new object is a client bug — reject it cleanly
            # instead of letting the unique constraint surface a raw DB error.
            if (
                command.type in _ADD_COMMANDS
                and command.temp_id
                and command.temp_id in temp_map
            ):
                raise CommandError(
                    "invalid_args",
                    f"temp_id already used in this workspace: {command.temp_id}",
                )

            resolved_args = _resolve_args(temp_map, command.args or {})
            result = handler(ctx, resolved_args)
            status = "ok"
            if command.type in _ADD_COMMANDS and command.temp_id and result.get("object_id"):
                object_id = str(result["object_id"])
                session.add(
                    TempIdMap(
                        workspace_id=workspace_id,
                        temp_id=command.temp_id,
                        object_id=result["object_id"],
                    )
                )
            record = {"status": status}
            if object_id:
                record["object_id"] = object_id
                record["temp_id"] = command.temp_id
            reasons = result.get("relocated")
            if reasons:
                record["relocated"] = {"reasons": list(reasons)}
            log = pg_insert(SyncedCommand).values(
                uuid=cmd_uuid_obj, workspace_id=workspace_id, status_json=record
            )
            # A rejection stored by a server before v1.5.2 may sit under this uuid:
            # it is overwritten. Nothing else can be: a success is only written
            # under the workspace lock, after the check above.
            session.execute(
                log.on_conflict_do_update(
                    index_elements=["workspace_id", "uuid"],
                    set_={"status_json": log.excluded.status_json},
                )
            )
            session.commit()
            # Only now: a failed commit must leave no mapping behind in memory.
            if object_id:
                temp_map[command.temp_id] = object_id
                temp_id_mapping[command.temp_id] = object_id
            sync_status[str(cmd_uuid)] = status
            if reasons:
                if relocated is not None:
                    relocated[str(cmd_uuid)] = record["relocated"]
                logger.info(
                    "command %s (%s) relocated in workspace %s (%s): task %s",
                    cmd_uuid, command.type, workspace_id, ", ".join(reasons),
                    result["object_id"],
                )
            # Fire-and-forget: post-commit so rows are durable; never affects status.
            dispatch_events(sm, user_id, ctx.events, event_sender)
            # Best-effort (remove_blob logs failures), and only now the rows are durable.
            # One failure must never turn the committed ok into an error.
            for blob_workspace_id, attachment_id in ctx.blob_deletions:
                try:
                    remove_blob(blob_workspace_id, attachment_id)
                except Exception:
                    logger.warning(
                        "removing blob of attachment %s failed (workspace %s)",
                        attachment_id, blob_workspace_id, exc_info=True,
                    )
        except CommandError as exc:
            session.rollback()
            status = {"error_code": exc.code, "error": exc.message}
            sync_status[str(cmd_uuid)] = status
        except Exception as exc:
            # unexpected -> invalid_args (transient DB errors abort the request)
            if is_transient_db_error(exc):
                # The database, not the command, is at fault (restart, dropped
                # connection, pool or lock wait timeout): a permanent
                # `invalid_args` made clients drop the user's queued edit. Fail
                # the request instead - commands already committed replay as
                # `ok`, the rest are judged again when the client resends.
                try:
                    session.rollback()
                except Exception:  # the connection may be gone already
                    logger.warning("rollback after a transient database error failed")
                logger.error(
                    "command %s (%s) hit a transient database error in workspace %s: "
                    "%s",
                    cmd_uuid, command.type, workspace_id, describe_transient_error(exc),
                )
                raise TransientDbError(type(exc).__name__) from exc
            session.rollback()
            # Never leak the driver/ORM message to the client: it carries table
            # names, constraint names and sometimes parameter values (S6).
            # A StatementError's text can carry Postgres's "Failing row contains (...)"
            # DETAIL, i.e. user content: log only its type.
            if isinstance(exc, StatementError):
                logger.error(
                    "command %s (%s) failed unexpectedly in workspace %s: %s",
                    cmd_uuid, command.type, workspace_id, type(exc).__name__,
                )
            else:
                logger.exception(
                    "command %s (%s) failed unexpectedly in workspace %s",
                    cmd_uuid, command.type, workspace_id,
                )
            status = {"error_code": "invalid_args", "error": "command could not be applied"}
            sync_status[str(cmd_uuid)] = status
        finally:
            session.close()

    return sync_status, temp_id_mapping
