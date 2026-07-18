"""Command handlers and the per-request orchestrator.

Each command runs in its own transaction (its own Session). A failure records an
error status and does not abort the remaining commands. Processed command uuids are
persisted for idempotent replay; temp_id -> object_id mappings persist across requests.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from ..events import (
    AssignmentEvent,
    CommentEvent,
    Event,
    EventSender,
    dispatch_events,
)
from ..models import (
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
from .recurrence import next_occurrence, parse_recurrence

VALID_COLORS = {
    "slate", "red", "orange", "amber", "green", "teal",
    "cyan", "blue", "indigo", "violet", "pink", "rose",
}

# Keys within command args that may carry an id or temp_id reference.
_REF_KEYS = ("id", "project_id", "section_id", "parent_task_id", "task_id")


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

    def bump(self) -> int:
        return bump_version(self.session, self.workspace_id)


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


def _require_str(args: dict, key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip():
        raise CommandError("invalid_args", f"{key} is required")
    return value


def _require_body(args: dict) -> str:
    value = args.get("body")
    if not isinstance(value, str) or not value.strip():
        raise CommandError("invalid_args", "body is required")
    if len(value) > 5000:
        raise CommandError("invalid_args", "body must be at most 5000 characters")
    return value


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
    try:
        parse_recurrence(value)
    except ValueError as exc:
        raise CommandError("invalid_args", f"invalid recurrence: {exc}") from exc
    return value


def _max_sort_order(ctx: Ctx, model, **filters) -> int:
    stmt = select(model.sort_order).where(model.workspace_id == ctx.workspace_id)
    for key, value in filters.items():
        col = getattr(model, key)
        stmt = stmt.where(col.is_(None) if value is None else col == value)
    stmt = stmt.where(model.is_deleted.is_(False))
    values = ctx.session.execute(stmt).scalars().all()
    return (max(values) if values else 0) + 1000


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
def _apply_task_fields(ctx: Ctx, task: Task, args: dict, *, creating: bool) -> None:
    if "title" in args:
        task.title = _require_str(args, "title")
    if "notes" in args:
        task.notes = args.get("notes") or ""
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
        sort_order=int(sort_order),
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
        project.sort_order = int(args["sort_order"])
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
    return {}


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
        sort_order=int(sort_order),
        version=version,
    )
    ctx.session.add(section)
    return {"object_id": section.id}


def h_section_update(ctx: Ctx, args: dict) -> dict:
    section = _get_section(ctx, args.get("id"))
    if "name" in args:
        section.name = _require_str(args, "name")
    if "sort_order" in args:
        section.sort_order = int(args["sort_order"])
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
    title = _require_str(args, "title")
    project_id = None
    if args.get("project_id") is not None:
        project_id = _get_project(ctx, args["project_id"]).id
    section_id = None
    if args.get("section_id") is not None:
        section_id = _get_section(ctx, args["section_id"]).id
    parent_task_id = _check_parent(ctx, args.get("parent_task_id"))

    version = ctx.bump()
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
    _apply_task_fields(ctx, task, args, creating=True)
    _record_assignment(ctx, task, previous=None)
    sort_order = args.get("sort_order")
    if sort_order is None:
        if parent_task_id is not None:
            sort_order = _max_sort_order(ctx, Task, parent_task_id=parent_task_id)
        else:
            sort_order = _max_sort_order(
                ctx, Task, project_id=project_id, section_id=section_id, parent_task_id=None
            )
    task.sort_order = int(sort_order)
    ctx.session.add(task)
    return {"object_id": task.id}


def h_task_update(ctx: Ctx, args: dict) -> dict:
    task = _get_task(ctx, args.get("id"))
    previous_assignee = task.assigned_to
    _apply_task_fields(ctx, task, args, creating=False)
    _record_assignment(ctx, task, previous=previous_assignee)
    task.version = ctx.bump()
    return {}


def h_task_move(ctx: Ctx, args: dict) -> dict:
    task = _get_task(ctx, args.get("id"))
    if "parent_task_id" in args:
        task.parent_task_id = _check_parent(ctx, args.get("parent_task_id"))
    if "project_id" in args:
        task.project_id = (
            _get_project(ctx, args["project_id"]).id if args.get("project_id") else None
        )
    if "section_id" in args:
        task.section_id = (
            _get_section(ctx, args["section_id"]).id if args.get("section_id") else None
        )
    if "sort_order" in args:
        task.sort_order = int(args["sort_order"])
    task.version = ctx.bump()
    return {}


def h_task_complete(ctx: Ctx, args: dict) -> dict:
    task = _get_task(ctx, args.get("id"))
    version = ctx.bump()
    if task.recurrence:
        today = date.today()
        if task.start_date is not None:
            reference = max(task.start_date, today)
            new_start = next_occurrence(task.recurrence, reference)
            delta = new_start - task.start_date
            task.start_date = new_start
            if task.deadline is not None:
                task.deadline = task.deadline + delta
        elif task.deadline is not None:
            reference = max(task.deadline, today)
            task.deadline = next_occurrence(task.recurrence, reference)
        else:
            task.start_date = next_occurrence(task.recurrence, today)
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
    # Cascade to comments of the task and its subtasks (§3.4).
    task_ids = [task.id, *(st.id for st in subtasks)]
    comments = ctx.session.execute(
        select(Comment).where(
            Comment.task_id.in_(task_ids), Comment.is_deleted.is_(False)
        )
    ).scalars().all()
    for c in comments:
        c.is_deleted = True
        c.version = version
    return {}


def h_task_reorder(ctx: Ctx, args: dict) -> dict:
    items = args.get("items")
    if not isinstance(items, list) or not items:
        raise CommandError("invalid_args", "items must be a non-empty list")
    tasks: list[tuple[Task, int]] = []
    for item in items:
        if not isinstance(item, dict) or "id" not in item or "sort_order" not in item:
            raise CommandError("invalid_args", "each item needs id and sort_order")
        task = _get_task(ctx, item["id"])
        tasks.append((task, int(item["sort_order"])))
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
    label = Label(
        id=uuid.uuid4(),
        workspace_id=ctx.workspace_id,
        name=name,
        color=color,
        sort_order=int(args.get("sort_order") or _max_sort_order(ctx, Label)),
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
        label.sort_order = int(args["sort_order"])
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


def _load_temp_map(session: Session, workspace_id: uuid.UUID) -> dict[str, str]:
    rows = session.execute(
        select(TempIdMap.temp_id, TempIdMap.object_id).where(
            TempIdMap.workspace_id == workspace_id
        )
    ).all()
    return {temp_id: str(object_id) for temp_id, object_id in rows}


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
def process_commands(
    sm: sessionmaker[Session],
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    role: str,
    commands: list,
    event_sender: EventSender = send_to_channel,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Apply commands in order, each in its own transaction.

    Returns (sync_status keyed by command uuid, temp_id_mapping).
    """
    sync_status: dict[str, Any] = {}
    temp_id_mapping: dict[str, str] = {}

    # Seed the in-memory temp map from persisted mappings.
    with sm() as seed_session:
        temp_map = _load_temp_map(seed_session, workspace_id)

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

        # Idempotent replay: return stored status without re-applying.
        with sm() as check_session:
            existing = check_session.get(SyncedCommand, cmd_uuid_obj)
            if existing is not None:
                sync_status[str(cmd_uuid)] = existing.status_json.get("status")
                stored_temp = existing.status_json.get("temp_id")
                stored_obj = existing.status_json.get("object_id")
                if stored_temp and stored_obj:
                    temp_map[stored_temp] = stored_obj
                    temp_id_mapping[stored_temp] = stored_obj
                continue

        handler = HANDLERS.get(command.type)
        status: Any
        result: dict = {}
        object_id: str | None = None

        session = sm()
        try:
            if handler is None:
                raise CommandError("invalid_args", f"unknown command type: {command.type}")
            if ROLE_RANK.get(role, 0) < ROLE_RANK["member"]:
                raise CommandError("forbidden", "viewer role is read-only")
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
            ctx = Ctx(
                session=session,
                workspace_id=workspace_id,
                user_id=user_id,
                role=role,
                temp_map=temp_map,
            )
            result = handler(ctx, resolved_args)
            status = "ok"
            if command.type in _ADD_COMMANDS and command.temp_id and result.get("object_id"):
                object_id = str(result["object_id"])
                temp_map[command.temp_id] = object_id
                temp_id_mapping[command.temp_id] = object_id
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
            session.add(
                SyncedCommand(
                    uuid=cmd_uuid_obj, workspace_id=workspace_id, status_json=record
                )
            )
            session.commit()
            sync_status[str(cmd_uuid)] = status
            # Fire-and-forget: post-commit so rows are durable; never affects status.
            dispatch_events(sm, user_id, ctx.events, event_sender)
        except CommandError as exc:
            session.rollback()
            status = {"error_code": exc.code, "error": exc.message}
            _record_failure(sm, cmd_uuid_obj, workspace_id, status)
            sync_status[str(cmd_uuid)] = status
        except Exception as exc:  # unexpected -> treat as invalid_args, keep going
            session.rollback()
            status = {"error_code": "invalid_args", "error": str(exc)}
            _record_failure(sm, cmd_uuid_obj, workspace_id, status)
            sync_status[str(cmd_uuid)] = status
        finally:
            session.close()

    return sync_status, temp_id_mapping


def _record_failure(sm, cmd_uuid_obj, workspace_id, status) -> None:
    with sm() as session:
        if session.get(SyncedCommand, cmd_uuid_obj) is None:
            session.add(
                SyncedCommand(
                    uuid=cmd_uuid_obj,
                    workspace_id=workspace_id,
                    status_json={"status": status},
                )
            )
            session.commit()
