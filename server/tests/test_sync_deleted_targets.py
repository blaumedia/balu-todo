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
