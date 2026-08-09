"""The MCP tool surface: schemas, dispatch, and readable JSON payloads.

Reads query the workspace directly and reuse :mod:`balu.sync.serialize`. Writes are
never applied here - they are turned into sync commands and handed to
:func:`balu.sync.commands.process_commands`, which owns role enforcement, version
stamping and event dispatch. Authorization is likewise borrowed rather than
restated: :func:`balu.routers.workspaces.get_membership` is the same check the REST
endpoints run.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, sessionmaker

from ..errors import ApiError
from ..events import EventSender
from ..models import Comment, Label, Membership, Project, Section, Task, User, Workspace
from ..routers.workspaces import get_membership
from ..schemas.sync import Command
from ..sync.commands import process_commands
from ..sync.serialize import iso_date, iso_dt

#: Cap on rows a single ``list_tasks`` call may return, so a model that omits
#: `limit` cannot pull a whole workspace into its context.
DEFAULT_TASK_LIMIT = 50
MAX_TASK_LIMIT = 200


class ToolError(Exception):
    """A tool failed in a way the model should see and can act on.

    ``applied`` lists the command types a multi-command tool already committed
    before the failure. Each command commits in its own transaction, so "nothing
    happened" is not something a tool may claim without checking.
    """

    def __init__(self, message: str, applied: list[str] | None = None) -> None:
        self.applied = applied or []
        super().__init__(message)


@dataclass
class ToolContext:
    db: Session
    sm: sessionmaker[Session]
    user: User
    event_sender: EventSender


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _require(args: dict, key: str) -> Any:
    value = args.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ToolError(f"{key} is required")
    return value


def _workspace(ctx: ToolContext, args: dict) -> tuple[uuid.UUID, str]:
    """Resolve `workspace_id` and the caller's role in it."""
    raw = _require(args, "workspace_id")
    try:
        ws_id = uuid.UUID(str(raw))
    except ValueError:
        raise ToolError("workspace_id is not a valid id") from None
    try:
        membership = get_membership(ctx.db, ws_id, ctx.user.id)
    except ApiError as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        raise ToolError(str(detail.get("message", "workspace not found"))) from None
    return ws_id, membership.role


def _uuid_arg(args: dict, key: str, required: bool = True) -> uuid.UUID | None:
    raw = args.get(key)
    if raw is None:
        if required:
            raise ToolError(f"{key} is required")
        return None
    try:
        return uuid.UUID(str(raw))
    except ValueError:
        raise ToolError(f"{key} is not a valid id") from None


def _limit_arg(args: dict) -> int:
    raw = args.get("limit")
    if raw is None:
        return DEFAULT_TASK_LIMIT
    # `bool` is an `int` subclass; `limit: true` is a mistake, not a row count.
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise ToolError("limit must be an integer")
    return max(1, min(raw, MAX_TASK_LIMIT))


def _ilike_literal(value: str) -> str:
    """Escape a user string so ILIKE matches it literally.

    The schema promises substring search; without this a `%` or `_` in the query
    silently becomes a wildcard.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _date_arg(args: dict, key: str) -> date | None:
    raw = args.get(key)
    if raw is None:
        return None
    try:
        return date.fromisoformat(str(raw))
    except ValueError:
        raise ToolError(f"{key} must be a YYYY-MM-DD date") from None


def _get_task(ctx: ToolContext, ws_id: uuid.UUID, task_id: uuid.UUID) -> Task:
    task = ctx.db.get(Task, task_id)
    if task is None or task.is_deleted or task.workspace_id != ws_id:
        raise ToolError("task not found")
    return task


def _get_project(ctx: ToolContext, ws_id: uuid.UUID, project_id: uuid.UUID) -> Project:
    project = ctx.db.get(Project, project_id)
    if project is None or project.is_deleted or project.workspace_id != ws_id:
        raise ToolError("project not found")
    return project


def _get_section(ctx: ToolContext, ws_id: uuid.UUID, section_id: uuid.UUID) -> Section:
    section = ctx.db.get(Section, section_id)
    if section is None or section.is_deleted or section.workspace_id != ws_id:
        raise ToolError("section not found")
    return section


def _label_ids_by_name(ctx: ToolContext, ws_id: uuid.UUID, names: Any) -> list[str]:
    """Map label names to ids. Labels are referenced by name because that is what
    a model has to work with; unknown names are rejected rather than created."""
    if not isinstance(names, list):
        raise ToolError("labels must be a list of label names")
    rows = ctx.db.execute(
        select(Label).where(Label.workspace_id == ws_id, Label.is_deleted.is_(False))
    ).scalars().all()
    by_name = {row.name.casefold(): row for row in rows}
    resolved: list[str] = []
    for name in names:
        label = by_name.get(str(name).casefold())
        if label is None:
            known = ", ".join(sorted(row.name for row in rows)) or "none"
            raise ToolError(f"unknown label: {name!r}. Labels in this workspace: {known}")
        resolved.append(str(label.id))
    return resolved


def _apply(ctx: ToolContext, ws_id: uuid.UUID, role: str, commands: list[Command]) -> dict:
    """Apply commands in order, stopping at the first rejection.

    ``process_commands`` commits each command in its own transaction and keeps
    going after a failure - which is right for a sync batch and wrong for a tool
    call, where handing it the whole list would let a later rejection be reported
    as failure while an earlier command is already durable. Feeding them one at a
    time makes "stop here" real, and the raised error names what did commit.
    """
    temp_id_mapping: dict[str, str] = {}
    for index, command in enumerate(commands):
        sync_status, mapping = process_commands(
            ctx.sm, ws_id, ctx.user.id, role, [command], event_sender=ctx.event_sender
        )
        temp_id_mapping.update(mapping)
        status = sync_status.get(command.uuid)
        if isinstance(status, dict):
            reason = str(status.get("error") or status.get("error_code") or "rejected")
            raise ToolError(reason, applied=[c.type for c in commands[:index]])
    return temp_id_mapping


# ---------------------------------------------------------------------------
# Payload shaping (readable: names next to ids)
# ---------------------------------------------------------------------------
def _names(ctx: ToolContext, ws_id: uuid.UUID) -> dict[str, dict[uuid.UUID, str]]:
    projects = ctx.db.execute(
        select(Project.id, Project.name).where(Project.workspace_id == ws_id)
    ).all()
    sections = ctx.db.execute(
        select(Section.id, Section.name).where(Section.workspace_id == ws_id)
    ).all()
    members = ctx.db.execute(
        select(User.id, User.name)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.workspace_id == ws_id)
    ).all()
    return {
        "projects": dict(projects),
        "sections": dict(sections),
        "members": dict(members),
    }


def _task_view(task: Task, names: dict[str, dict[uuid.UUID, str]]) -> dict[str, Any]:
    return {
        "id": str(task.id),
        "title": task.title,
        "notes": task.notes or None,
        "completed": task.completed_at is not None,
        "completed_at": iso_dt(task.completed_at),
        "project_id": str(task.project_id) if task.project_id else None,
        "project": names["projects"].get(task.project_id),
        "section_id": str(task.section_id) if task.section_id else None,
        "section": names["sections"].get(task.section_id),
        "parent_task_id": str(task.parent_task_id) if task.parent_task_id else None,
        "start_date": iso_date(task.start_date),
        "deadline": iso_date(task.deadline),
        "someday": task.someday,
        "recurrence": task.recurrence,
        "priority": task.priority,
        "labels": [label.name for label in task.labels],
        "assignee_id": str(task.assigned_to) if task.assigned_to else None,
        "assignee": names["members"].get(task.assigned_to),
        "created_at": iso_dt(task.created_at),
        "updated_at": iso_dt(task.updated_at),
    }


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------
def t_list_workspaces(ctx: ToolContext, args: dict) -> dict:
    rows = ctx.db.execute(
        select(Membership, Workspace)
        .join(Workspace, Workspace.id == Membership.workspace_id)
        .where(Membership.user_id == ctx.user.id, Membership.is_deleted.is_(False))
    ).all()
    ws_ids = [workspace.id for _, workspace in rows]

    # One query for every workspace's members, not one per workspace.
    members_by_ws: dict[uuid.UUID, list[dict[str, str]]] = {ws_id: [] for ws_id in ws_ids}
    if ws_ids:
        member_rows = ctx.db.execute(
            select(Membership, User)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.workspace_id.in_(ws_ids),
                Membership.is_deleted.is_(False),
            )
        ).all()
        for m, u in member_rows:
            members_by_ws[m.workspace_id].append(
                {"id": str(u.id), "name": u.name, "email": u.email, "role": m.role}
            )

    workspaces = [
        {
            "id": str(workspace.id),
            "name": workspace.name,
            "your_role": membership.role,
            "members": members_by_ws[workspace.id],
        }
        for membership, workspace in rows
    ]
    return {"workspaces": workspaces, "you": str(ctx.user.id)}


def t_list_projects(ctx: ToolContext, args: dict) -> dict:
    ws_id, _ = _workspace(ctx, args)
    projects = ctx.db.execute(
        select(Project)
        .where(Project.workspace_id == ws_id, Project.is_deleted.is_(False))
        .order_by(Project.sort_order)
    ).scalars().all()
    sections = ctx.db.execute(
        select(Section)
        .where(Section.workspace_id == ws_id, Section.is_deleted.is_(False))
        .order_by(Section.sort_order)
    ).scalars().all()
    labels = ctx.db.execute(
        select(Label)
        .where(Label.workspace_id == ws_id, Label.is_deleted.is_(False))
        .order_by(Label.sort_order)
    ).scalars().all()
    return {
        "projects": [
            {
                "id": str(p.id),
                "name": p.name,
                "color": p.color,
                "archived": p.archived_at is not None,
                "sections": [
                    {"id": str(s.id), "name": s.name}
                    for s in sections
                    if s.project_id == p.id
                ],
            }
            for p in projects
        ],
        "labels": [label.name for label in labels],
    }


def t_list_tasks(ctx: ToolContext, args: dict) -> dict:
    ws_id, _ = _workspace(ctx, args)
    stmt = select(Task).where(Task.workspace_id == ws_id, Task.is_deleted.is_(False))

    status = args.get("status", "open")
    if status not in ("open", "completed", "all"):
        raise ToolError("status must be one of: open, completed, all")
    if status == "open":
        stmt = stmt.where(Task.completed_at.is_(None))
    elif status == "completed":
        stmt = stmt.where(Task.completed_at.is_not(None))

    project_id = _uuid_arg(args, "project_id", required=False)
    if project_id is not None:
        stmt = stmt.where(Task.project_id == project_id)
    if args.get("assigned_to_me"):
        stmt = stmt.where(Task.assigned_to == ctx.user.id)

    for key, column, op in (
        ("start_date_from", Task.start_date, "ge"),
        ("start_date_to", Task.start_date, "le"),
        ("deadline_from", Task.deadline, "ge"),
        ("deadline_to", Task.deadline, "le"),
    ):
        bound = _date_arg(args, key)
        if bound is not None:
            stmt = stmt.where(column >= bound if op == "ge" else column <= bound)

    search = args.get("search")
    if isinstance(search, str) and search.strip():
        pattern = f"%{_ilike_literal(search.strip())}%"
        stmt = stmt.where(
            or_(
                Task.title.ilike(pattern, escape="\\"),
                Task.notes.ilike(pattern, escape="\\"),
            )
        )

    limit = _limit_arg(args)
    stmt = stmt.order_by(Task.sort_order, Task.created_at).limit(limit + 1)

    tasks = ctx.db.execute(stmt).scalars().all()
    truncated = len(tasks) > limit
    tasks = tasks[:limit]
    names = _names(ctx, ws_id)
    return {
        "tasks": [_task_view(t, names) for t in tasks],
        "count": len(tasks),
        "truncated": truncated,
    }


def t_get_task(ctx: ToolContext, args: dict) -> dict:
    ws_id, _ = _workspace(ctx, args)
    task = _get_task(ctx, ws_id, _uuid_arg(args, "task_id"))
    names = _names(ctx, ws_id)
    comments = ctx.db.execute(
        select(Comment)
        .where(Comment.task_id == task.id, Comment.is_deleted.is_(False))
        .order_by(Comment.created_at)
    ).scalars().all()
    subtasks = ctx.db.execute(
        select(Task)
        .where(Task.parent_task_id == task.id, Task.is_deleted.is_(False))
        .order_by(Task.sort_order)
    ).scalars().all()
    view = _task_view(task, names)
    view["comments"] = [
        {
            "id": str(c.id),
            "author": names["members"].get(c.author_id),
            "body": c.body,
            "created_at": iso_dt(c.created_at),
        }
        for c in comments
    ]
    view["subtasks"] = [
        {"id": str(s.id), "title": s.title, "completed": s.completed_at is not None}
        for s in subtasks
    ]
    return view


def _task_field_args(ctx: ToolContext, ws_id: uuid.UUID, args: dict) -> dict:
    """Translate tool arguments into `task_add` / `task_update` command args.

    Only keys the caller actually sent are forwarded: the command handlers treat
    a present key as "set this", so passing everything would clear every field
    the model did not mention.
    """
    out: dict[str, Any] = {}
    for key in ("title", "notes", "start_date", "deadline", "priority"):
        if key in args:
            out[key] = args[key]
    if "labels" in args:
        out["label_ids"] = _label_ids_by_name(ctx, ws_id, args["labels"])
    if "assignee_id" in args:
        assignee = args["assignee_id"]
        if assignee is None:
            out["assigned_to"] = None
        else:
            uid = _uuid_arg(args, "assignee_id")
            m = ctx.db.get(Membership, {"workspace_id": ws_id, "user_id": uid})
            if m is None or m.is_deleted:
                raise ToolError("assignee_id must be a member of this workspace")
            out["assigned_to"] = str(uid)
    return out


def _placement_args(
    ctx: ToolContext, ws_id: uuid.UUID, args: dict, current_project_id: uuid.UUID | None
) -> dict:
    """Validate and translate the project/section references.

    Checked up front rather than left to the command handler because `update_task`
    can issue two commands: a section that does not belong to its project has to be
    rejected before the first one commits, not between them.
    """
    out: dict[str, Any] = {}
    project_id = current_project_id
    if "project_id" in args:
        pid = _uuid_arg(args, "project_id", required=False)
        if pid is not None:
            _get_project(ctx, ws_id, pid)
        project_id = pid
        out["project_id"] = None if pid is None else str(pid)
    if "section_id" in args:
        sid = _uuid_arg(args, "section_id", required=False)
        if sid is not None:
            section = _get_section(ctx, ws_id, sid)
            if section.project_id != project_id:
                raise ToolError("section_id must belong to the task's project")
        out["section_id"] = None if sid is None else str(sid)
    return out


def t_create_task(ctx: ToolContext, args: dict) -> dict:
    ws_id, role = _workspace(ctx, args)
    _require(args, "title")
    command_args = _task_field_args(ctx, ws_id, args)
    command_args.update(_placement_args(ctx, ws_id, args, None))

    temp_id = f"mcp-{uuid.uuid4()}"
    command = Command(
        type="task_add", uuid=str(uuid.uuid4()), temp_id=temp_id, args=command_args
    )
    mapping = _apply(ctx, ws_id, role, [command])
    task_id = uuid.UUID(mapping[temp_id])
    ctx.db.expire_all()
    return {"created": _task_view(_get_task(ctx, ws_id, task_id), _names(ctx, ws_id))}


def t_update_task(ctx: ToolContext, args: dict) -> dict:
    ws_id, role = _workspace(ctx, args)
    task_id = _uuid_arg(args, "task_id")
    task = _get_task(ctx, ws_id, task_id)

    def command(type_: str, command_args: dict) -> Command:
        return Command(
            type=type_, uuid=str(uuid.uuid4()), args={"id": str(task_id), **command_args}
        )

    # Both halves are validated before either is applied: they commit in separate
    # transactions, so a reference the second one rejects must not get past the
    # first (see `_apply`).
    field_args = _task_field_args(ctx, ws_id, args)
    # project/section live on `task_move`, not `task_update` - moving also has to
    # drop a section that no longer belongs to the new project, which that handler
    # already does.
    move_args = _placement_args(ctx, ws_id, args, task.project_id)

    commands: list[Command] = []
    if field_args:
        commands.append(command("task_update", field_args))
    if move_args:
        commands.append(command("task_move", move_args))
    if not commands:
        raise ToolError("nothing to update: pass at least one field")

    _apply(ctx, ws_id, role, commands)
    ctx.db.expire_all()
    return {"updated": _task_view(_get_task(ctx, ws_id, task_id), _names(ctx, ws_id))}


def _completion(ctx: ToolContext, args: dict, command_type: str) -> dict:
    ws_id, role = _workspace(ctx, args)
    task_id = _uuid_arg(args, "task_id")
    _get_task(ctx, ws_id, task_id)
    _apply(
        ctx,
        ws_id,
        role,
        [Command(type=command_type, uuid=str(uuid.uuid4()), args={"id": str(task_id)})],
    )
    ctx.db.expire_all()
    return {"task": _task_view(_get_task(ctx, ws_id, task_id), _names(ctx, ws_id))}


def t_complete_task(ctx: ToolContext, args: dict) -> dict:
    return _completion(ctx, args, "task_complete")


def t_reopen_task(ctx: ToolContext, args: dict) -> dict:
    return _completion(ctx, args, "task_uncomplete")


def t_add_comment(ctx: ToolContext, args: dict) -> dict:
    ws_id, role = _workspace(ctx, args)
    task_id = _uuid_arg(args, "task_id")
    _get_task(ctx, ws_id, task_id)
    body = _require(args, "body")
    temp_id = f"mcp-{uuid.uuid4()}"
    mapping = _apply(
        ctx,
        ws_id,
        role,
        [
            Command(
                type="comment_add",
                uuid=str(uuid.uuid4()),
                temp_id=temp_id,
                args={"task_id": str(task_id), "body": body},
            )
        ],
    )
    return {"comment_id": mapping[temp_id], "task_id": str(task_id), "body": body}


# ---------------------------------------------------------------------------
# Tool catalog
# ---------------------------------------------------------------------------
_WORKSPACE_ID = {
    "type": "string",
    "description": "Workspace id from list_workspaces.",
}
_TASK_ID = {"type": "string", "description": "Task id from list_tasks or get_task."}

_TASK_FIELDS: dict[str, Any] = {
    "notes": {"type": ["string", "null"], "description": "Free-form body text of the task."},
    "project_id": {
        "type": ["string", "null"],
        "description": "Project to file the task under, or null for the inbox.",
    },
    "section_id": {
        "type": ["string", "null"],
        "description": "Section within that project (must belong to it), or null.",
    },
    "start_date": {
        "type": ["string", "null"],
        "description": (
            "When work should start (YYYY-MM-DD). This is what drives Today and "
            "Upcoming, not the deadline."
        ),
    },
    "deadline": {
        "type": ["string", "null"],
        "description": "Hard due date (YYYY-MM-DD). Separate from start_date.",
    },
    "priority": {
        "type": "integer",
        "enum": [0, 1, 2, 3],
        "description": "0 none, 1 low, 2 medium, 3 high.",
    },
    "labels": {
        "type": "array",
        "items": {"type": "string"},
        "description": (
            "Label names, replacing the current set. They must already exist in the "
            "workspace - list_projects returns them."
        ),
    },
    "assignee_id": {
        "type": ["string", "null"],
        "description": "Workspace member id from list_workspaces, or null to unassign.",
    },
}


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Any

    def spec(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema,
        }


def _schema(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


TOOLS: tuple[Tool, ...] = (
    Tool(
        name="list_workspaces",
        description=(
            "List the workspaces you belong to, your role in each, and their members. "
            "Start here: every other tool needs a workspace_id, and assignee ids come "
            "from the member list."
        ),
        input_schema=_schema({}, []),
        handler=t_list_workspaces,
    ),
    Tool(
        name="list_projects",
        description=(
            "List the projects of a workspace with their sections, plus the "
            "workspace's label names."
        ),
        input_schema=_schema({"workspace_id": _WORKSPACE_ID}, ["workspace_id"]),
        handler=t_list_projects,
    ),
    Tool(
        name="list_tasks",
        description=(
            "List tasks in a workspace. Open tasks only unless `status` says otherwise. "
            "Filters combine with AND. `truncated` says whether more rows matched than "
            "the limit returned."
        ),
        input_schema=_schema(
            {
                "workspace_id": _WORKSPACE_ID,
                "project_id": {
                    "type": "string",
                    "description": "Restrict to one project.",
                },
                "status": {
                    "type": "string",
                    "enum": ["open", "completed", "all"],
                    "description": "Defaults to open.",
                },
                "start_date_from": {
                    "type": "string",
                    "description": "Start date on or after this YYYY-MM-DD date.",
                },
                "start_date_to": {
                    "type": "string",
                    "description": "Start date on or before this YYYY-MM-DD date.",
                },
                "deadline_from": {
                    "type": "string",
                    "description": "Deadline on or after this YYYY-MM-DD date.",
                },
                "deadline_to": {
                    "type": "string",
                    "description": "Deadline on or before this YYYY-MM-DD date.",
                },
                "assigned_to_me": {
                    "type": "boolean",
                    "description": "Only tasks assigned to the authenticated user.",
                },
                "search": {
                    "type": "string",
                    "description": "Case-insensitive substring match on title and notes.",
                },
                "limit": {
                    "type": "integer",
                    "description": (
                        f"Max rows, default {DEFAULT_TASK_LIMIT}, capped at {MAX_TASK_LIMIT}."
                    ),
                },
            },
            ["workspace_id"],
        ),
        handler=t_list_tasks,
    ),
    Tool(
        name="get_task",
        description="Read one task in full, including its comments and subtasks.",
        input_schema=_schema(
            {"workspace_id": _WORKSPACE_ID, "task_id": _TASK_ID},
            ["workspace_id", "task_id"],
        ),
        handler=t_get_task,
    ),
    Tool(
        name="create_task",
        description=(
            "Create a task. Only `title` is required; every other field is optional and "
            "unset fields stay empty. Returns the created task."
        ),
        input_schema=_schema(
            {
                "workspace_id": _WORKSPACE_ID,
                "title": {"type": "string", "description": "Short imperative title."},
                **_TASK_FIELDS,
            },
            ["workspace_id", "title"],
        ),
        handler=t_create_task,
    ),
    Tool(
        name="update_task",
        description=(
            "Change fields of an existing task. Only the fields you pass are touched; "
            "pass null to clear a nullable one. Use complete_task/reopen_task for completion."
        ),
        input_schema=_schema(
            {
                "workspace_id": _WORKSPACE_ID,
                "task_id": _TASK_ID,
                "title": {"type": "string", "description": "New title."},
                **_TASK_FIELDS,
            },
            ["workspace_id", "task_id"],
        ),
        handler=t_update_task,
    ),
    Tool(
        name="complete_task",
        description=(
            "Mark a task done. A recurring task is not closed but rolled forward to its "
            "next occurrence, so the returned task may still be open with a later date."
        ),
        input_schema=_schema(
            {"workspace_id": _WORKSPACE_ID, "task_id": _TASK_ID},
            ["workspace_id", "task_id"],
        ),
        handler=t_complete_task,
    ),
    Tool(
        name="reopen_task",
        description="Undo a completion: put a completed task back on the open list.",
        input_schema=_schema(
            {"workspace_id": _WORKSPACE_ID, "task_id": _TASK_ID},
            ["workspace_id", "task_id"],
        ),
        handler=t_reopen_task,
    ),
    Tool(
        name="add_comment",
        description=(
            "Post a comment on a task. Other members of the workspace are notified through "
            "their configured channels."
        ),
        input_schema=_schema(
            {
                "workspace_id": _WORKSPACE_ID,
                "task_id": _TASK_ID,
                "body": {"type": "string", "description": "Comment text."},
            },
            ["workspace_id", "task_id", "body"],
        ),
        handler=t_add_comment,
    ),
)

TOOLS_BY_NAME = {tool.name: tool for tool in TOOLS}


def tool_specs() -> list[dict[str, Any]]:
    return [tool.spec() for tool in TOOLS]


def call_tool(ctx: ToolContext, name: str, args: dict) -> dict:
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        raise ToolError(f"unknown tool: {name}")
    return tool.handler(ctx, args or {})
