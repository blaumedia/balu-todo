"""Conflict policy (§5.5), idempotent replay, viewer role, recurring completion."""

from __future__ import annotations

import uuid
from datetime import date

from balu.models import Membership
from balu.sync.engine import bump_version
from balu.sync.recurrence import next_occurrence
from tests.conftest import auth_headers, cmd, register_user, sync


def _only(items):
    assert len(items) == 1, items
    return items[0]


def _make_task(client, user, **fields) -> str:
    r = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="T", **fields)])
    return r["temp_id_mapping"]["t1"]


# ---- §5.5 conflict cases -------------------------------------------------
def test_cross_field_patches_merge(client, user):
    tid = _make_task(client, user)
    # two separate patches touching different fields -> both survive
    sync(client, user, "*", [cmd("task_update", id=tid, title="Renamed")])
    r = sync(client, user, "*", [cmd("task_update", id=tid, priority=1)])
    t = _only([x for x in r["tasks"] if x["id"] == tid])
    assert t["title"] == "Renamed"
    assert t["priority"] == 1


def test_same_field_last_write_wins(client, user):
    tid = _make_task(client, user)
    # two updates to the same field in one batch, applied in order -> last wins
    r = sync(
        client,
        user,
        "*",
        [
            cmd("task_update", id=tid, title="First"),
            cmd("task_update", id=tid, title="Second"),
        ],
    )
    assert _only([x for x in r["tasks"] if x["id"] == tid])["title"] == "Second"


def test_update_after_delete_is_not_found(client, user):
    tid = _make_task(client, user)
    sync(client, user, "*", [cmd("task_delete", id=tid)])
    upd = cmd("task_update", id=tid, title="Zombie")
    r = sync(client, user, "*", [upd])
    assert r["sync_status"][upd["uuid"]]["error_code"] == "not_found"


def test_move_and_complete_both_apply(client, user):
    r0 = sync(
        client,
        user,
        "*",
        [cmd("project_add", temp_id="p", name="P"), cmd("task_add", temp_id="t", title="T")],
    )
    pid = r0["temp_id_mapping"]["p"]
    tid = r0["temp_id_mapping"]["t"]
    r = sync(
        client,
        user,
        "*",
        [cmd("task_move", id=tid, project_id=pid), cmd("task_complete", id=tid)],
    )
    t = _only([x for x in r["tasks"] if x["id"] == tid])
    assert t["project_id"] == pid  # move applied
    assert t["completed_at"] is not None  # complete applied


def test_reorder_race_last_wins(client, user):
    r0 = sync(
        client,
        user,
        "*",
        [cmd("task_add", temp_id="a", title="A"), cmd("task_add", temp_id="b", title="B")],
    )
    a = r0["temp_id_mapping"]["a"]
    sync(client, user, "*", [cmd("task_reorder", items=[{"id": a, "sort_order": 1000}])])
    r = sync(client, user, "*", [cmd("task_reorder", items=[{"id": a, "sort_order": 9000}])])
    assert _only([x for x in r["tasks"] if x["id"] == a])["sort_order"] == 9000


# ---- Idempotent replay ---------------------------------------------------
def test_idempotent_replay_same_uuid(client, user):
    add = cmd("task_add", temp_id="t1", title="Once")
    r1 = sync(client, user, "*", [add])
    status1 = r1["sync_status"][add["uuid"]]
    assert status1 == "ok"

    # replay the exact same command (same uuid)
    r2 = sync(client, user, "*", [add])
    status2 = r2["sync_status"][add["uuid"]]
    assert status2 == status1  # same stored status
    # temp mapping still resolves to the original object
    assert r2["temp_id_mapping"]["t1"] == r1["temp_id_mapping"]["t1"]

    # only one task exists
    full = sync(client, user, "*")
    assert len([t for t in full["tasks"] if t["title"] == "Once"]) == 1


def test_rejected_command_is_re_evaluated_and_fails_again_when_nothing_changed(
    client, user, db
):
    from sqlalchemy import func, select

    from balu.models import SyncedCommand

    upd = cmd("task_update", id=str(uuid.uuid4()), title="Ghost")
    r1 = sync(client, user, "*", [upd])
    r2 = sync(client, user, "*", [upd])
    assert r1["sync_status"][upd["uuid"]] == r2["sync_status"][upd["uuid"]]
    assert r2["sync_status"][upd["uuid"]]["error_code"] == "not_found"
    assert (
        db.execute(
            select(func.count())
            .select_from(SyncedCommand)
            .where(SyncedCommand.uuid == uuid.UUID(upd["uuid"]))
        ).scalar_one()
        == 0
    )


# ---- Viewer role ---------------------------------------------------------
def test_viewer_can_pull_but_not_command(client, user, db):
    # Create a second user and directly add them as a viewer on user's workspace.
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

    # Pull works.
    pull = sync(client, viewer_user, "*")
    assert pull["full_sync"] is True

    # Any command is forbidden.
    add = cmd("task_add", temp_id="x", title="nope")
    resp = sync(client, viewer_user, "*", [add])
    assert resp["sync_status"][add["uuid"]]["error_code"] == "forbidden"
    # ...and nothing was created.
    assert resp["tasks"] == [] or all(t["title"] != "nope" for t in resp["tasks"])


# ---- Recurring completion ------------------------------------------------
def test_recurring_complete_advances_dates_keeps_open(client, user):
    start = "2099-01-05"
    deadline = "2099-01-09"
    tid = _make_task(
        client, user, start_date=start, deadline=deadline, recurrence="FREQ=DAILY;INTERVAL=1"
    )
    r = sync(client, user, "*", [cmd("task_complete", id=tid)])
    t = _only([x for x in r["tasks"] if x["id"] == tid])

    reference = max(date.fromisoformat(start), date.today())
    expected_start = next_occurrence("FREQ=DAILY;INTERVAL=1", reference)
    delta = expected_start - date.fromisoformat(start)
    expected_deadline = date.fromisoformat(deadline) + delta

    assert t["completed_at"] is None  # recurring never completes
    assert t["start_date"] == expected_start.isoformat()
    assert t["deadline"] == expected_deadline.isoformat()


def test_recurring_weekly_byday_completion(client, user):
    start = "2099-07-21"  # a Tuesday
    tid = _make_task(
        client, user, start_date=start, recurrence="FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR"
    )
    r = sync(client, user, "*", [cmd("task_complete", id=tid)])
    t = _only([x for x in r["tasks"] if x["id"] == tid])
    reference = max(date.fromisoformat(start), date.today())
    expected = next_occurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR", reference)
    assert t["completed_at"] is None
    assert t["start_date"] == expected.isoformat()


def test_non_recurring_complete_sets_completed_at(client, user):
    tid = _make_task(client, user, start_date="2099-01-05")
    r = sync(client, user, "*", [cmd("task_complete", id=tid)])
    t = _only([x for x in r["tasks"] if x["id"] == tid])
    assert t["completed_at"] is not None


# ---- Rejections are re-evaluated, successes replay ------------------------
def test_rejected_task_add_succeeds_when_re_sent_after_its_parent_arrived(client, user):
    child = cmd("task_add", temp_id="c", title="Child", parent_task_id="tp")
    r1 = sync(client, user, "*", [child])
    assert r1["sync_status"][child["uuid"]]["error_code"] == "not_found"

    parent = cmd("task_add", temp_id="tp", title="Parent")
    r2 = sync(client, user, "*", [parent])
    assert r2["sync_status"][parent["uuid"]] == "ok"
    parent_id = r2["temp_id_mapping"]["tp"]

    r3 = sync(client, user, "*", [child])
    assert r3["sync_status"][child["uuid"]] == "ok"
    assert "c" in r3["temp_id_mapping"]
    child_task = _only([t for t in r3["tasks"] if t["id"] == r3["temp_id_mapping"]["c"]])
    assert child_task["parent_task_id"] == parent_id

    r4 = sync(client, user, "*", [child])
    assert r4["sync_status"][child["uuid"]] == "ok"
    assert r4["temp_id_mapping"]["c"] == r3["temp_id_mapping"]["c"]
    assert len([t for t in r4["tasks"] if t["title"] == "Child"]) == 1


def test_legacy_stored_rejection_is_re_evaluated_and_then_replays_its_success(
    client, user, db
):
    from balu.models import SyncedCommand
    from tests.test_sync_deleted_targets import _deleted_project_with_section

    pid, _sid, _token = _deleted_project_with_section(client, user)
    u = uuid.uuid4()
    ws = uuid.UUID(user["workspace_id"])
    db.add(
        SyncedCommand(
            workspace_id=ws,
            uuid=u,
            status_json={"status": {"error_code": "not_found", "error": "project not found"}},
        )
    )
    db.commit()

    add = cmd("task_add", str(u), temp_id="tmp-legacy", title="Legacy", project_id=pid)
    r1 = sync(client, user, "*", [add])
    assert r1["sync_status"][str(u)] == "ok"
    assert r1["relocated"][str(u)] == {"reasons": ["project_deleted"]}
    assert "tmp-legacy" in r1["temp_id_mapping"]
    db.expire_all()
    assert db.get(SyncedCommand, {"workspace_id": ws, "uuid": u}).status_json["status"] == "ok"

    r2 = sync(client, user, "*", [add])
    assert r2["sync_status"][str(u)] == "ok"
    assert r2["temp_id_mapping"] == r1["temp_id_mapping"]
    assert r2["relocated"] == r1["relocated"]
    assert len([t for t in r2["tasks"] if t["title"] == "Legacy"]) == 1


def test_rejected_viewer_command_succeeds_after_promotion(client, user, db):
    viewer = register_user(client, email="viewer2@example.com", name="Vera")
    viewer_id = uuid.UUID(viewer["user"]["id"])
    ws_id = uuid.UUID(user["workspace_id"])
    version = bump_version(db, ws_id)
    db.add(Membership(workspace_id=ws_id, user_id=viewer_id, role="viewer", version=version))
    db.commit()
    viewer_user = {
        "headers": auth_headers(viewer["access_token"]),
        "workspace_id": user["workspace_id"],
    }

    add = cmd("task_add", temp_id="vt", title="By viewer")
    r1 = sync(client, viewer_user, "*", [add])
    assert r1["sync_status"][add["uuid"]]["error_code"] == "forbidden"

    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{viewer['user']['id']}",
        headers=user["headers"],
        json={"role": "member"},
    )
    assert resp.status_code == 200, resp.text

    r2 = sync(client, viewer_user, "*", [add])
    assert r2["sync_status"][add["uuid"]] == "ok"


# ---- Races: judged and applied under the workspace lock -------------------
def _run_commands_blocked(user, who_id, role, commands, s0_sql=None, params=None):
    """Run process_commands in a thread parked on the workspace lock held by `s0`."""
    from sqlalchemy import text

    from balu.db import get_sessionmaker
    from balu.schemas.sync import Command
    from balu.sync.commands import process_commands
    from tests.conftest import Background, wait_for_lock_waiters

    sm = get_sessionmaker()
    ws = uuid.UUID(user["workspace_id"])
    cmds = [Command(**c) for c in commands]
    with sm() as s0:
        bump_version(s0, ws)
        if s0_sql:
            s0.execute(text(s0_sql), {"w": ws, **(params or {})})
        bg = Background(lambda: process_commands(sm, ws, who_id, role, cmds))
        wait_for_lock_waiters(1)
        s0.commit()
    return bg.result()


def test_concurrent_requests_with_one_uuid_apply_it_once(client, user):
    from balu.db import get_sessionmaker
    from balu.schemas.sync import Command
    from balu.sync.commands import process_commands
    from tests.conftest import Background, wait_for_lock_waiters

    sm = get_sessionmaker()
    ws = uuid.UUID(user["workspace_id"])
    owner = uuid.UUID(user["user"]["id"])
    command = Command(**cmd("task_add", temp_id="t", title="Exactly once"))
    with sm() as s0:
        bump_version(s0, ws)
        a = Background(lambda: process_commands(sm, ws, owner, "owner", [command]))
        b = Background(lambda: process_commands(sm, ws, owner, "owner", [command]))
        wait_for_lock_waiters(2)
        s0.commit()
    (st_a, map_a), (st_b, map_b) = a.result(), b.result()
    assert st_a[command.uuid] == "ok"
    assert st_b[command.uuid] == "ok"
    assert map_a == map_b
    full = sync(client, user, "*")
    assert len([t for t in full["tasks"] if t["title"] == "Exactly once"]) == 1


def _otto_member(client, user):
    from tests.test_members import _join

    return _join(client, user, role="member")


def test_member_removed_mid_request_is_forbidden(client, user):
    otto = _otto_member(client, user)
    add = cmd("task_add", temp_id="t", title="Late write")
    statuses, _ = _run_commands_blocked(
        user,
        uuid.UUID(otto["user"]["id"]),
        "member",
        [add],
        "UPDATE memberships SET is_deleted = true WHERE workspace_id = :w AND user_id = :u",
        {"u": uuid.UUID(otto["user"]["id"])},
    )
    assert statuses[add["uuid"]] == {
        "error_code": "forbidden",
        "error": "you are no longer a member of this workspace",
    }
    assert not [t for t in sync(client, user, "*")["tasks"] if t["title"] == "Late write"]


def test_member_demoted_mid_request_is_forbidden(client, user):
    otto = _otto_member(client, user)
    add = cmd("task_add", temp_id="t", title="Late write")
    statuses, _ = _run_commands_blocked(
        user,
        uuid.UUID(otto["user"]["id"]),
        "member",
        [add],
        "UPDATE memberships SET role = 'viewer' WHERE workspace_id = :w AND user_id = :u",
        {"u": uuid.UUID(otto["user"]["id"])},
    )
    assert statuses[add["uuid"]] == {
        "error_code": "forbidden",
        "error": "viewer role is read-only",
    }
    assert not [t for t in sync(client, user, "*")["tasks"] if t["title"] == "Late write"]


def test_admin_demoted_mid_request_cannot_delete_others_comments(client, user):
    from tests.test_members import _join

    r = sync(client, user, "*", [cmd("task_add", temp_id="t", title="Discuss")])
    task_id = r["temp_id_mapping"]["t"]
    r = sync(client, user, "*", [cmd("comment_add", temp_id="c", task_id=task_id, body="hi")])
    comment_id = r["temp_id_mapping"]["c"]
    admin = _join(client, user, role="admin")
    delete = cmd("comment_delete", id=comment_id)
    statuses, _ = _run_commands_blocked(
        user,
        uuid.UUID(admin["user"]["id"]),
        "admin",
        [delete],
        "UPDATE memberships SET role = 'member' WHERE workspace_id = :w AND user_id = :u",
        {"u": uuid.UUID(admin["user"]["id"])},
    )
    assert statuses[delete["uuid"]] == {
        "error_code": "forbidden",
        "error": "only the author or an admin can delete a comment",
    }


def test_command_against_a_workspace_deleted_mid_request_is_not_found(client, user):
    add = cmd("task_add", temp_id="t", title="Nowhere")
    statuses, _ = _run_commands_blocked(
        user,
        uuid.UUID(user["user"]["id"]),
        "owner",
        [add],
        "DELETE FROM workspaces WHERE id = :w",
    )
    assert statuses[add["uuid"]] == {"error_code": "not_found", "error": "workspace not found"}


def test_temp_id_committed_while_waiting_for_the_lock_is_invalid_args(client, user):
    add = cmd("task_add", temp_id="taken-meanwhile", title="Second")
    statuses, mapping = _run_commands_blocked(
        user,
        uuid.UUID(user["user"]["id"]),
        "owner",
        [add],
        "INSERT INTO temp_id_map (workspace_id, temp_id, object_id, created_at) "
        "VALUES (:w, 'taken-meanwhile', :o, now())",
        {"o": uuid.uuid4()},
    )
    assert statuses[add["uuid"]]["error_code"] == "invalid_args"
    assert statuses[add["uuid"]]["error"].startswith("temp_id already used")
    assert mapping == {}


def test_mapping_is_recorded_only_after_the_commit_succeeds(client, user, monkeypatch):
    from sqlalchemy.orm import Session

    real_commit = Session.commit
    armed = {"fail": True}

    def commit(self):
        if armed["fail"]:
            armed["fail"] = False
            raise RuntimeError("commit failed")
        return real_commit(self)

    first = cmd("task_add", temp_id="t", title="First")
    second = cmd("task_add", temp_id="t", title="Second")
    monkeypatch.setattr(Session, "commit", commit)
    r = sync(client, user, "*", [first, second])
    monkeypatch.undo()

    assert r["sync_status"][first["uuid"]]["error_code"] == "invalid_args"
    assert r["sync_status"][second["uuid"]] == "ok"
    full = sync(client, user, "*")
    mapped = next(t for t in full["tasks"] if t["id"] == r["temp_id_mapping"]["t"])
    assert mapped["title"] == "Second"
