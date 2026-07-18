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


def test_idempotent_replay_error_status_stable(client, user):
    upd = cmd("task_update", id=str(uuid.uuid4()), title="Ghost")
    r1 = sync(client, user, "*", [upd])
    r2 = sync(client, user, "*", [upd])
    assert r1["sync_status"][upd["uuid"]] == r2["sync_status"][upd["uuid"]]
    assert r2["sync_status"][upd["uuid"]]["error_code"] == "not_found"


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
