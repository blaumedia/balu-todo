"""task_add into a target deleted before the device synced (contract §5.5, v1.5.1)."""

from __future__ import annotations

import logging
import uuid

from balu.models import Membership
from balu.sync.engine import bump_version
from tests.conftest import auth_headers, cmd, register_user, sync
from tests.test_sync_commands import _second_workspace


def _task(body, task_id):
    return next(t for t in body["tasks"] if t["id"] == task_id)


def _deleted_project_with_section(client, user):
    body = sync(client, user, "*", [
        cmd("project_add", temp_id="p", name="Doomed"),
        cmd("section_add", temp_id="s", project_id="p", name="Doomed section"),
    ])
    pid, sid = body["temp_id_mapping"]["p"], body["temp_id_mapping"]["s"]
    body = sync(client, user, body["sync_token"], [cmd("project_delete", id=pid)])
    return pid, sid, body["sync_token"]


def _live_project_with_section(client, user):
    body = sync(client, user, "*", [
        cmd("project_add", temp_id="p", name="Live"),
        cmd("section_add", temp_id="s", project_id="p", name="Live section"),
    ])
    return body["temp_id_mapping"]["p"], body["temp_id_mapping"]["s"], body["sync_token"]


def test_task_add_into_deleted_project_lands_in_inbox(client, user):
    pid, _sid, token = _deleted_project_with_section(client, user)
    add = cmd("task_add", temp_id="tmp-offline", title="Buy milk", project_id=pid)
    body = sync(client, user, token, [add])
    # Must be the exact string: client.ts treats anything else as a rejection.
    assert body["sync_status"][add["uuid"]] == "ok"
    assert "tmp-offline" in body["temp_id_mapping"]
    task = _task(body, body["temp_id_mapping"]["tmp-offline"])
    assert task["title"] == "Buy milk"
    assert task["project_id"] is None
    assert task["section_id"] is None
    assert task["parent_task_id"] is None
    assert task["is_deleted"] is False
    assert body["relocated"] == {add["uuid"]: {"reasons": ["project_deleted"]}}


def test_task_add_into_section_of_deleted_project_lands_in_inbox(client, user):
    pid, sid, token = _deleted_project_with_section(client, user)
    add = cmd("task_add", temp_id="t", title="X", project_id=pid, section_id=sid)
    body = sync(client, user, token, [add])
    assert body["sync_status"][add["uuid"]] == "ok"
    task = _task(body, body["temp_id_mapping"]["t"])
    assert task["project_id"] is None
    assert task["section_id"] is None
    assert body["relocated"][add["uuid"]] == {"reasons": ["project_deleted"]}


def test_task_add_into_deleted_section_lands_in_project_body(client, user):
    pid, sid, token = _live_project_with_section(client, user)
    body = sync(client, user, token, [cmd("section_delete", id=sid)])
    add = cmd("task_add", temp_id="t", title="X", project_id=pid, section_id=sid)
    body = sync(client, user, body["sync_token"], [add])
    assert body["sync_status"][add["uuid"]] == "ok"
    task = _task(body, body["temp_id_mapping"]["t"])
    assert task["project_id"] == pid
    assert task["section_id"] is None
    assert body["relocated"][add["uuid"]] == {"reasons": ["section_deleted"]}


def test_subtask_of_deleted_parent_becomes_top_level_in_its_project(client, user):
    pid, _sid, token = _live_project_with_section(client, user)
    body = sync(client, user, token, [
        cmd("task_add", temp_id="par", title="Parent", project_id=pid),
    ])
    parent = body["temp_id_mapping"]["par"]
    body = sync(client, user, body["sync_token"], [cmd("task_delete", id=parent)])
    add = cmd("task_add", temp_id="t", title="Child", project_id=pid, parent_task_id=parent)
    body = sync(client, user, body["sync_token"], [add])
    assert body["sync_status"][add["uuid"]] == "ok"
    task = _task(body, body["temp_id_mapping"]["t"])
    assert task["title"] == "Child"
    assert task["project_id"] == pid
    assert task["parent_task_id"] is None
    assert body["relocated"][add["uuid"]] == {"reasons": ["parent_deleted"]}


def test_subtask_of_cascade_deleted_parent_lands_in_inbox(client, user):
    body = sync(client, user, "*", [
        cmd("project_add", temp_id="p", name="Doomed"),
    ])
    pid = body["temp_id_mapping"]["p"]
    body = sync(client, user, body["sync_token"], [
        cmd("task_add", temp_id="par", title="Parent", project_id=pid),
    ])
    parent = body["temp_id_mapping"]["par"]
    body = sync(client, user, body["sync_token"], [cmd("project_delete", id=pid)])
    a = cmd("task_add", temp_id="a", title="A", parent_task_id=parent)
    b = cmd("task_add", temp_id="b", title="B", parent_task_id=parent, project_id=pid)
    body = sync(client, user, body["sync_token"], [a, b])
    assert body["sync_status"][a["uuid"]] == "ok"
    assert body["sync_status"][b["uuid"]] == "ok"
    assert body["relocated"][a["uuid"]] == {"reasons": ["parent_deleted"]}
    assert body["relocated"][b["uuid"]] == {"reasons": ["project_deleted", "parent_deleted"]}
    for temp in ("a", "b"):
        task = _task(body, body["temp_id_mapping"][temp])
        assert task["project_id"] is None
        assert task["parent_task_id"] is None


def test_relocated_add_is_appended_ignoring_client_sort_order(client, user):
    sync(client, user, "*", [cmd("task_add", temp_id="e", title="Existing")])
    pid, _sid, token = _deleted_project_with_section(client, user)
    add = cmd("task_add", temp_id="t", title="Moved", project_id=pid, sort_order=5)
    sync(client, user, token, [add])
    full = sync(client, user, "*")
    new_id = next(t["id"] for t in full["tasks"] if t["title"] == "Moved")
    others = [
        t["sort_order"]
        for t in full["tasks"]
        if t["id"] != new_id
        and not t["is_deleted"]
        and t["project_id"] is None
        and t["section_id"] is None
        and t["parent_task_id"] is None
    ]
    assert others
    assert _task(full, new_id)["sort_order"] == max(others) + 1000


def test_plain_task_add_reports_no_relocation(client, user):
    pid, _sid, token = _live_project_with_section(client, user)
    body = sync(client, user, token, [
        cmd("task_add", temp_id="t", title="Fine", project_id=pid),
    ])
    assert body["relocated"] == {}


def test_task_add_into_unknown_project_is_still_not_found(client, user):
    add = cmd("task_add", temp_id="t", title="Ghost task", project_id=str(uuid.uuid4()))
    body = sync(client, user, "*", [add])
    assert body["sync_status"][add["uuid"]]["error_code"] == "not_found"
    assert body["relocated"] == {}
    assert all(t["title"] != "Ghost task" for t in body["tasks"])


def test_deleted_section_of_another_project_is_still_invalid_args(client, user):
    body = sync(client, user, "*", [
        cmd("project_add", temp_id="a", name="A"),
        cmd("project_add", temp_id="b", name="B"),
        cmd("section_add", temp_id="s", project_id="a", name="S"),
    ])
    pb, sa = body["temp_id_mapping"]["b"], body["temp_id_mapping"]["s"]
    body = sync(client, user, body["sync_token"], [cmd("section_delete", id=sa)])
    add = cmd("task_add", temp_id="t", title="X", project_id=pb, section_id=sa)
    body = sync(client, user, body["sync_token"], [add])
    assert body["sync_status"][add["uuid"]]["error_code"] == "invalid_args"


def test_deleted_section_without_project_is_invalid_args(client, user):
    _pid, sid, token = _live_project_with_section(client, user)
    body = sync(client, user, token, [cmd("section_delete", id=sid)])
    add = cmd("task_add", temp_id="t", title="X", section_id=sid)
    body = sync(client, user, body["sync_token"], [add])
    assert body["sync_status"][add["uuid"]]["error_code"] == "invalid_args"
    assert body["relocated"] == {}


def test_unresolvable_temp_section_of_deleted_project_still_files_in_inbox(client, user):
    pid, _sid, token = _deleted_project_with_section(client, user)
    sec = cmd("section_add", temp_id="s2", project_id=pid, name="Late")
    add = cmd("task_add", temp_id="t", title="Keep me", project_id=pid, section_id="s2")
    body = sync(client, user, token, [sec, add])
    assert body["sync_status"][sec["uuid"]]["error_code"] == "not_found"
    assert body["sync_status"][add["uuid"]] == "ok"
    task = _task(body, body["temp_id_mapping"]["t"])
    assert task["project_id"] is None
    assert task["section_id"] is None
    assert body["relocated"][add["uuid"]] == {"reasons": ["project_deleted"]}


def test_section_of_other_project_is_ignored_when_project_is_deleted(client, user):
    pid, _sid, token = _deleted_project_with_section(client, user)
    live = sync(client, user, token, [
        cmd("project_add", temp_id="lp", name="Live"),
        cmd("section_add", temp_id="ls", project_id="lp", name="Live section"),
    ])
    live_sid = live["temp_id_mapping"]["ls"]
    add = cmd("task_add", temp_id="t", title="Keep me", project_id=pid, section_id=live_sid)
    body = sync(client, user, live["sync_token"], [add])
    assert body["sync_status"][add["uuid"]] == "ok"
    task = _task(body, body["temp_id_mapping"]["t"])
    assert task["project_id"] is None
    assert task["section_id"] is None
    assert body["relocated"][add["uuid"]] == {"reasons": ["project_deleted"]}


def _sync_in(client, user, ws_id, token, commands):
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/sync",
        headers=user["headers"],
        json={"sync_token": token, "commands": commands},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_deleted_project_of_another_workspace_is_not_found(client, user):
    ws_b = _second_workspace(client, user)
    body = _sync_in(client, user, ws_b, "*", [cmd("project_add", temp_id="p", name="B proj")])
    pb = body["temp_id_mapping"]["p"]
    _sync_in(client, user, ws_b, body["sync_token"], [cmd("project_delete", id=pb)])
    add = cmd("task_add", temp_id="t", title="Leak", project_id=pb)
    body = sync(client, user, "*", [add])
    assert body["sync_status"][add["uuid"]]["error_code"] == "not_found"
    assert body["relocated"] == {}
    assert all(t["title"] != "Leak" for t in body["tasks"])


def test_deleted_parent_of_another_workspace_is_not_found(client, user):
    ws_b = _second_workspace(client, user)
    body = _sync_in(client, user, ws_b, "*", [cmd("task_add", temp_id="par", title="B parent")])
    parent = body["temp_id_mapping"]["par"]
    _sync_in(client, user, ws_b, body["sync_token"], [cmd("task_delete", id=parent)])
    add = cmd("task_add", temp_id="t", title="Leak", parent_task_id=parent)
    body = sync(client, user, "*", [add])
    assert body["sync_status"][add["uuid"]]["error_code"] == "not_found"
    assert body["relocated"] == {}
    assert all(t["title"] != "Leak" for t in body["tasks"])


def test_deleted_parent_that_was_a_subtask_is_still_relocated(client, user):
    pid, _sid, token = _live_project_with_section(client, user)
    body = sync(client, user, token, [
        cmd("task_add", temp_id="top", title="Top", project_id=pid),
    ])
    top = body["temp_id_mapping"]["top"]
    body = sync(client, user, body["sync_token"], [
        cmd("task_add", temp_id="mid", title="Mid", project_id=pid, parent_task_id=top),
    ])
    mid = body["temp_id_mapping"]["mid"]
    body = sync(client, user, body["sync_token"], [cmd("task_delete", id=mid)])
    add = cmd("task_add", temp_id="t", title="Leaf", project_id=pid, parent_task_id=mid)
    body = sync(client, user, body["sync_token"], [add])
    assert body["sync_status"][add["uuid"]] == "ok"
    assert body["relocated"][add["uuid"]] == {"reasons": ["parent_deleted"]}


def test_task_move_into_deleted_project_is_still_not_found(client, user):
    body = sync(client, user, "*", [cmd("task_add", temp_id="t", title="Stay")])
    tid = body["temp_id_mapping"]["t"]
    pid, _sid, token = _deleted_project_with_section(client, user)
    move = cmd("task_move", id=tid, project_id=pid)
    body = sync(client, user, token, [move])
    assert body["sync_status"][move["uuid"]]["error_code"] == "not_found"
    full = sync(client, user, "*")
    assert _task(full, tid)["project_id"] is None


def test_ops_on_cascade_deleted_task_stay_not_found(client, user):
    body = sync(client, user, "*", [cmd("project_add", temp_id="p", name="Doomed")])
    pid = body["temp_id_mapping"]["p"]
    body = sync(client, user, body["sync_token"], [
        cmd("task_add", temp_id="t", title="T", project_id=pid),
    ])
    tid = body["temp_id_mapping"]["t"]
    body = sync(client, user, body["sync_token"], [cmd("project_delete", id=pid)])
    cmds = [
        cmd("task_update", id=tid, title="New"),
        cmd("task_complete", id=tid),
        cmd("task_move", id=tid, project_id=None),
        cmd("comment_add", task_id=tid, body="x"),
    ]
    body = sync(client, user, body["sync_token"], cmds)
    for c in cmds:
        assert body["sync_status"][c["uuid"]]["error_code"] == "not_found"
    full = sync(client, user, "*")
    assert all(t["id"] != tid for t in full["tasks"])


def test_viewer_is_still_forbidden_on_a_deleted_target(client, user, db):
    pid, _sid, _token = _deleted_project_with_section(client, user)
    viewer = register_user(client, email="viewer@example.com", name="Vera")
    viewer_id = uuid.UUID(viewer["user"]["id"])
    ws_id = uuid.UUID(user["workspace_id"])
    version = bump_version(db, ws_id)
    db.add(Membership(workspace_id=ws_id, user_id=viewer_id, role="viewer", version=version))
    db.commit()
    viewer_user = {
        "headers": auth_headers(viewer["access_token"]),
        "workspace_id": user["workspace_id"],
    }
    add = cmd("task_add", temp_id="t", title="nope", project_id=pid)
    body = sync(client, viewer_user, "*", [add])
    assert body["sync_status"][add["uuid"]]["error_code"] == "forbidden"
    assert body["relocated"] == {}


def test_replay_of_relocated_add_is_idempotent(client, user):
    pid, _sid, token = _deleted_project_with_section(client, user)
    add = cmd("task_add", temp_id="tmp-offline", title="Buy milk", project_id=pid)
    r1 = sync(client, user, token, [add])
    r2 = sync(client, user, token, [add])
    assert r2["sync_status"][add["uuid"]] == "ok"
    assert r2["temp_id_mapping"]["tmp-offline"] == r1["temp_id_mapping"]["tmp-offline"]
    assert r2["relocated"] == r1["relocated"]
    assert r2["relocated"][add["uuid"]] == {"reasons": ["project_deleted"]}
    full = sync(client, user, "*")
    assert len([t for t in full["tasks"] if t["title"] == "Buy milk"]) == 1


def test_relocation_is_logged(client, user, caplog):
    pid, _sid, token = _deleted_project_with_section(client, user)
    add = cmd("task_add", temp_id="t", title="Buy milk", project_id=pid)
    with caplog.at_level(logging.INFO, logger="balu.sync.commands"):
        sync(client, user, token, [add])
    messages = [r.getMessage() for r in caplog.records]
    assert any(
        r.levelno == logging.INFO and "project_deleted" in r.getMessage()
        for r in caplog.records
    )
    assert all("Buy milk" not in m for m in messages)


def test_migrations_leave_application_loggers_enabled():
    from balu.migrate import run_migrations

    run_migrations()
    assert logging.getLogger("balu.sync.commands").disabled is False
    assert logging.getLogger("balu.main").disabled is False


def test_alembic_logger_is_info_with_one_shared_handler_after_create_app():
    from balu.main import create_app

    create_app()
    create_app()
    alembic_logger = logging.getLogger("alembic")
    assert alembic_logger.level == logging.INFO
    tagged = [h for h in alembic_logger.handlers if getattr(h, "_balu_app", False)]
    assert len(tagged) == 1
    assert tagged[0] in logging.getLogger("balu").handlers


def test_task_add_waits_for_an_uncommitted_project_delete_then_lands_in_inbox(client, user):
    """task_add must serialise behind an in-flight project_delete (review runs
    a6ec1231 and 4240a9dc).

    project_delete bumps the workspace version first, which row-locks the workspace;
    task_add bumps before any lookup, so it blocks on that lock and, once the delete
    commits, reads the project as deleted. No project row lock is taken, so the two
    cannot deadlock. Threaded, but deterministic: the adder is released only by the
    deleter's commit, and the "still blocked" check is a bounded wait.
    """
    import threading

    from balu.db import get_sessionmaker
    from balu.models import Task
    from balu.sync.commands import Ctx, h_project_delete, h_task_add

    pid, _sid, _token = _live_project_with_section(client, user)
    sm = get_sessionmaker()
    workspace_id = uuid.UUID(user["workspace_id"])
    user_id = uuid.UUID(user["user"]["id"])
    started, done = threading.Event(), threading.Event()
    outcome: dict = {}

    def add_task():
        try:
            with sm() as session:
                ctx = Ctx(
                    session=session, workspace_id=workspace_id, user_id=user_id,
                    role="owner", temp_map={},
                )
                started.set()
                outcome["result"] = h_task_add(
                    ctx, {"title": "In flight", "project_id": pid}
                )
                session.commit()
        except BaseException as exc:  # surfaced by the assertions below
            outcome["error"] = exc
        finally:
            done.set()

    with sm() as deleter:
        h_project_delete(
            Ctx(
                session=deleter, workspace_id=workspace_id, user_id=user_id,
                role="owner", temp_map={},
            ),
            {"id": pid},
        )
        thread = threading.Thread(target=add_task)
        thread.start()
        assert started.wait(10)
        assert not done.wait(0.5), "task_add did not wait for the uncommitted delete"
        deleter.commit()
    thread.join(15)
    assert done.is_set()
    assert "error" not in outcome, outcome.get("error")
    assert outcome["result"]["relocated"] == ["project_deleted"]
    with sm() as session:
        task = session.get(Task, outcome["result"]["object_id"])
        assert task.project_id is None
        assert task.is_deleted is False


def _run_blocked_command(user, delete_handler, delete_args, command):
    """Apply `command` through process_commands in a thread while another session
    holds an uncommitted delete; assert the command waits for it, release it by
    committing, and return (sync_status entry, command uuid) after the join."""
    import threading

    from balu.db import get_sessionmaker
    from balu.sync.commands import Ctx, process_commands

    sm = get_sessionmaker()
    workspace_id = uuid.UUID(user["workspace_id"])
    user_id = uuid.UUID(user["user"]["id"])
    done = threading.Event()
    outcome: dict = {}

    class _Command:
        type = command["type"]
        args = command["args"]
        temp_id = command.get("temp_id")
        uuid = command["uuid"]

    def apply():
        try:
            outcome["status"], _ = process_commands(
                sm, workspace_id, user_id, "owner", [_Command()]
            )
        except BaseException as exc:  # surfaced by the assertions below
            outcome["error"] = exc
        finally:
            done.set()

    with sm() as deleter:
        delete_handler(
            Ctx(
                session=deleter, workspace_id=workspace_id, user_id=user_id,
                role="owner", temp_map={},
            ),
            delete_args,
        )
        thread = threading.Thread(target=apply)
        thread.start()
        assert not done.wait(0.5), "command did not wait for the uncommitted delete"
        deleter.commit()
    thread.join(15)
    assert done.is_set()
    assert "error" not in outcome, outcome.get("error")
    return outcome["status"][command["uuid"]]


def test_task_move_with_section_waits_for_an_uncommitted_task_delete(client, user):
    """task_move used to flush its project_id change (locking the task row) before
    the workspace lock: it moved a task a concurrent task_delete had removed (and
    could deadlock against it) (review run 062744e0)."""
    from balu.sync.commands import h_task_delete

    pid, sid, token = _live_project_with_section(client, user)
    body = sync(client, user, token, [cmd("task_add", temp_id="t", title="Moving")])
    tid = body["temp_id_mapping"]["t"]
    move = cmd("task_move", id=tid, project_id=pid, section_id=sid)
    status = _run_blocked_command(user, h_task_delete, {"id": tid}, move)
    assert status == {"error_code": "not_found", "error": "task not found"}


def test_section_add_and_task_move_wait_for_an_uncommitted_project_delete(client, user):
    from balu.sync.commands import h_project_delete

    pid, sid, token = _live_project_with_section(client, user)
    body = sync(client, user, token, [cmd("task_add", temp_id="t", title="Mover")])
    tid = body["temp_id_mapping"]["t"]
    add = cmd("section_add", temp_id="s2", project_id=pid, name="Late")
    status = _run_blocked_command(user, h_project_delete, {"id": pid}, add)
    assert status["error_code"] == "not_found"

    body = sync(client, user, "*", [
        cmd("project_add", temp_id="p2", name="Second"),
        cmd("section_add", temp_id="s3", project_id="p2", name="Second section"),
    ])
    pid2, sid2 = body["temp_id_mapping"]["p2"], body["temp_id_mapping"]["s3"]
    move = cmd("task_move", id=tid, project_id=pid2, section_id=sid2)
    status = _run_blocked_command(user, h_project_delete, {"id": pid2}, move)
    assert status["error_code"] == "not_found"
    body = sync(client, user, "*", [])
    assert not [s for s in body["sections"] if s["name"] == "Late"]
    assert _task(body, tid)["project_id"] is None


def test_task_move_into_section_waits_for_an_uncommitted_section_delete(client, user):
    from balu.sync.commands import h_section_delete

    pid, sid, token = _live_project_with_section(client, user)
    body = sync(client, user, token, [cmd("task_add", temp_id="t", title="Mover")])
    tid = body["temp_id_mapping"]["t"]
    move = cmd("task_move", id=tid, project_id=pid, section_id=sid)
    status = _run_blocked_command(user, h_section_delete, {"id": sid}, move)
    assert status["error_code"] == "not_found"
    assert _task(sync(client, user, "*", []), tid)["section_id"] is None


def test_httpx_and_httpcore_loggers_are_pinned_to_warning():
    from balu.main import create_app

    create_app()
    assert logging.getLogger("httpx").level == logging.WARNING
    assert logging.getLogger("httpcore").level == logging.WARNING


def test_uvicorn_access_log_redacts_mixed_case_invite_paths():
    from balu.main import create_app

    create_app()
    access = logging.getLogger("uvicorn.access")
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:1", "GET", "/Invite/SECRET-TOKEN", "1.1", 200), None,
    )
    assert access.filter(record)
    assert "SECRET-TOKEN" not in record.getMessage()


def _integrity_error():
    from sqlalchemy.exc import IntegrityError

    return IntegrityError(
        "INSERT ...", {}, Exception("Failing row contains (SECRET)")
    )


def test_sync_dbapi_error_is_logged_by_type_only(client, user, monkeypatch, caplog):
    from balu.sync import commands

    def boom(ctx, args):
        raise _integrity_error()

    monkeypatch.setitem(commands.HANDLERS, "task_add", boom)
    with caplog.at_level(logging.INFO, logger="balu"):
        body = sync(client, user, "*", [cmd("task_add", temp_id="t", title="x")])
    status = next(iter(body["sync_status"].values()))
    assert status == {"error_code": "invalid_args", "error": "command could not be applied"}
    assert "IntegrityError" in caplog.text
    assert "SECRET" not in caplog.text
    assert all(r.exc_info is None for r in caplog.records)


def test_mcp_dbapi_error_is_logged_by_type_only(client, user, monkeypatch, caplog):
    from balu.config import get_settings
    from balu.mcp import protocol
    from tests.test_mcp import mcp_key, rpc

    def boom(ctx, name, arguments):
        raise _integrity_error()

    settings = get_settings()
    settings.mcp_enabled = True
    try:
        key = mcp_key(client, user)
        monkeypatch.setattr(protocol, "call_tool", boom)
        with caplog.at_level(logging.INFO, logger="balu"):
            resp = rpc(client, key, "tools/call", {"name": "list_workspaces", "arguments": {}})
    finally:
        settings.mcp_enabled = False
    assert resp.json()["error"]["message"] == "Tool call failed"
    assert "IntegrityError" in caplog.text
    assert "SECRET" not in caplog.text
    assert all(r.exc_info is None for r in caplog.records)


def test_unhandled_dbapi_error_in_a_router_is_a_generic_500_without_detail(
    client, caplog
):
    from balu.main import app

    api = app.state.api

    @api.get("/_boom")
    def boom():
        raise _integrity_error()

    try:
        with caplog.at_level(logging.INFO, logger="balu"):
            resp = client.get("/api/v1/_boom")
    finally:
        api.router.routes[:] = [
            r for r in api.router.routes if getattr(r, "path", "") != "/_boom"
        ]
    assert resp.status_code == 500
    assert "SECRET" not in resp.text
    assert "IntegrityError" in caplog.text
    assert "/_boom" in caplog.text
    assert "SECRET" not in caplog.text
    assert all(r.exc_info is None for r in caplog.records)


def test_uvicorn_access_log_redacts_invite_tokens_once():
    from balu.main import create_app

    create_app()
    create_app()
    access = logging.getLogger("uvicorn.access")
    assert len([f for f in access.filters if type(f).__name__ == "_RedactInviteTokens"]) == 1
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:1", "GET", "/invite/SECRET-TOKEN?x=1", "1.1", 200), None,
    )
    assert access.filter(record)
    assert "SECRET-TOKEN" not in record.getMessage()
    assert "/invite/<redacted>?x=1" in record.getMessage()
    other = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1, "%s", ("/api/v1/me",), None
    )
    access.filter(other)
    assert other.getMessage() == "/api/v1/me"


def test_upload_waits_for_an_uncommitted_task_delete(client, user, tmp_path, monkeypatch):
    """The upload takes the workspace lock before looking the task up, so a
    task_delete still in flight is committed first: 404, no attachment row and no
    blob left on disk (review run 77777ed7)."""
    import threading

    from sqlalchemy import select

    from balu.config import get_settings
    from balu.db import get_sessionmaker
    from balu.models import Attachment
    from balu.sync.commands import Ctx, h_task_delete

    monkeypatch.setenv("BALU_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    try:
        body = sync(client, user, "*", [cmd("task_add", temp_id="t", title="Doomed")])
        tid = body["temp_id_mapping"]["t"]
        sm = get_sessionmaker()
        workspace_id = uuid.UUID(user["workspace_id"])
        done = threading.Event()
        outcome: dict = {}

        def upload():
            try:
                outcome["resp"] = client.post(
                    f"/api/v1/workspaces/{user['workspace_id']}/attachments",
                    headers=user["headers"],
                    data={"task_id": tid},
                    files={"file": ("a.png", b"pixels", "image/png")},
                )
            except BaseException as exc:  # surfaced by the assertions below
                outcome["error"] = exc
            finally:
                done.set()

        with sm() as deleter:
            h_task_delete(
                Ctx(
                    session=deleter, workspace_id=workspace_id,
                    user_id=uuid.UUID(user["user"]["id"]), role="owner", temp_map={},
                ),
                {"id": tid},
            )
            thread = threading.Thread(target=upload)
            thread.start()
            assert not done.wait(1.0), "upload did not wait for the uncommitted delete"
            deleter.commit()
        thread.join(15)
        assert done.is_set()
        assert "error" not in outcome, outcome.get("error")
        assert outcome["resp"].status_code == 404
        with sm() as session:
            assert session.scalars(select(Attachment)).all() == []
        assert [p for p in tmp_path.rglob("*") if p.is_file()] == []
    finally:
        get_settings.cache_clear()
