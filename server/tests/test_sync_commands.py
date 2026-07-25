"""Happy-path coverage for every command in the catalog + temp_id resolution."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from tests.conftest import cmd, sync


def _only(items):
    assert len(items) == 1, items
    return items[0]


def test_project_lifecycle(client, user):
    r = sync(client, user, "*", [cmd("project_add", temp_id="p1", name="Finanzen", color="blue")])
    assert r["sync_status"][list(r["sync_status"])[0]] == "ok"
    pid = r["temp_id_mapping"]["p1"]
    proj = _only(r["projects"])
    assert proj["name"] == "Finanzen" and proj["color"] == "blue"
    assert proj["sort_order"] == 1000

    r2 = sync(client, user, "*", [cmd("project_update", id=pid, name="Geld", color="green")])
    proj = _only([p for p in r2["projects"] if p["id"] == pid])
    assert proj["name"] == "Geld" and proj["color"] == "green"

    r3 = sync(client, user, r2["sync_token"], [cmd("project_delete", id=pid)])
    proj = _only([p for p in r3["projects"] if p["id"] == pid])
    assert proj["is_deleted"] is True


def test_project_delete_cascades_sections_and_tasks(client, user):
    r = sync(
        client,
        user,
        "*",
        [
            cmd("project_add", temp_id="p1", name="P"),
            cmd("section_add", temp_id="s1", project_id="p1", name="Sec"),
            cmd("task_add", temp_id="t1", title="T", project_id="p1", section_id="s1"),
        ],
    )
    pid = r["temp_id_mapping"]["p1"]
    sid = r["temp_id_mapping"]["s1"]
    tid = r["temp_id_mapping"]["t1"]
    r2 = sync(client, user, r["sync_token"], [cmd("project_delete", id=pid)])
    assert _only([p for p in r2["projects"] if p["id"] == pid])["is_deleted"]
    assert _only([s for s in r2["sections"] if s["id"] == sid])["is_deleted"]
    assert _only([t for t in r2["tasks"] if t["id"] == tid])["is_deleted"]


def test_section_lifecycle_and_delete_reparents_tasks(client, user):
    r = sync(
        client,
        user,
        "*",
        [
            cmd("project_add", temp_id="p1", name="P"),
            cmd("section_add", temp_id="s1", project_id="p1", name="Sec"),
            cmd("task_add", temp_id="t1", title="T", project_id="p1", section_id="s1"),
        ],
    )
    sid = r["temp_id_mapping"]["s1"]
    tid = r["temp_id_mapping"]["t1"]

    upd = sync(client, user, "*", [cmd("section_update", id=sid, name="Renamed")])
    assert _only([s for s in upd["sections"] if s["id"] == sid])["name"] == "Renamed"

    dele = sync(client, user, upd["sync_token"], [cmd("section_delete", id=sid)])
    assert _only([s for s in dele["sections"] if s["id"] == sid])["is_deleted"]
    task = _only([t for t in dele["tasks"] if t["id"] == tid])
    assert task["section_id"] is None  # moved to project body


def test_task_add_all_fields(client, user):
    r = sync(
        client,
        user,
        "*",
        [
            cmd(
                "task_add",
                temp_id="t1",
                title="Steuer",
                notes="hint",
                start_date="2026-07-24",
                deadline="2026-07-31",
                priority=1,
                evening=True,
            )
        ],
    )
    t = _only(r["tasks"])
    assert t["title"] == "Steuer"
    assert t["notes"] == "hint"
    assert t["start_date"] == "2026-07-24"
    assert t["deadline"] == "2026-07-31"
    assert t["priority"] == 1
    assert t["evening"] is True
    assert t["completed_at"] is None
    assert t["created_by"] == user["user"]["id"]


def test_someday_forces_start_date_null(client, user):
    r = sync(
        client,
        user,
        "*",
        [cmd("task_add", temp_id="t1", title="Later", start_date="2026-07-24", someday=True)],
    )
    t = _only(r["tasks"])
    assert t["someday"] is True
    assert t["start_date"] is None

    # updating someday=true on an existing dated task also clears start_date
    r2 = sync(
        client, user, "*", [cmd("task_add", temp_id="t2", title="X", start_date="2026-08-01")]
    )
    tid = r2["temp_id_mapping"]["t2"]
    r3 = sync(client, user, "*", [cmd("task_update", id=tid, someday=True)])
    assert _only([t for t in r3["tasks"] if t["id"] == tid])["start_date"] is None


def test_task_update_patch_semantics(client, user):
    r = sync(
        client,
        user,
        "*",
        [cmd("task_add", temp_id="t1", title="Orig", deadline="2026-07-31", priority=2)],
    )
    tid = r["temp_id_mapping"]["t1"]
    # update only title; deadline & priority untouched
    r2 = sync(client, user, "*", [cmd("task_update", id=tid, title="Changed")])
    t = _only([x for x in r2["tasks"] if x["id"] == tid])
    assert t["title"] == "Changed"
    assert t["deadline"] == "2026-07-31"
    assert t["priority"] == 2
    # explicit null clears deadline
    r3 = sync(client, user, "*", [cmd("task_update", id=tid, deadline=None)])
    assert _only([x for x in r3["tasks"] if x["id"] == tid])["deadline"] is None


def test_task_move(client, user):
    r = sync(
        client,
        user,
        "*",
        [
            cmd("project_add", temp_id="p1", name="P"),
            cmd("task_add", temp_id="t1", title="T"),
        ],
    )
    pid = r["temp_id_mapping"]["p1"]
    tid = r["temp_id_mapping"]["t1"]
    r2 = sync(client, user, "*", [cmd("task_move", id=tid, project_id=pid, sort_order=5000)])
    t = _only([x for x in r2["tasks"] if x["id"] == tid])
    assert t["project_id"] == pid
    assert t["sort_order"] == 5000


def test_subtasks_one_level(client, user):
    r = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="Parent")])
    parent = r["temp_id_mapping"]["t1"]
    r2 = sync(
        client, user, "*", [cmd("task_add", temp_id="t2", title="Child", parent_task_id=parent)]
    )
    child = r2["temp_id_mapping"]["t2"]
    # a grandchild is rejected
    gc = cmd("task_add", temp_id="t3", title="GC", parent_task_id=child)
    r3 = sync(client, user, "*", [gc])
    status = r3["sync_status"][gc["uuid"]]
    assert status["error_code"] == "invalid_args"


def test_task_complete_and_uncomplete(client, user):
    r = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="Do it")])
    tid = r["temp_id_mapping"]["t1"]
    r2 = sync(client, user, "*", [cmd("task_complete", id=tid)])
    t = _only([x for x in r2["tasks"] if x["id"] == tid])
    assert t["completed_at"] is not None
    assert t["completed_by"] == user["user"]["id"]

    r3 = sync(client, user, "*", [cmd("task_uncomplete", id=tid)])
    t = _only([x for x in r3["tasks"] if x["id"] == tid])
    assert t["completed_at"] is None
    assert t["completed_by"] is None


def test_task_delete_cascades_subtasks(client, user):
    r = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="Parent")])
    parent = r["temp_id_mapping"]["t1"]
    r2 = sync(
        client, user, "*", [cmd("task_add", temp_id="t2", title="Child", parent_task_id=parent)]
    )
    child = r2["temp_id_mapping"]["t2"]
    # incremental token so the response includes the soft-deleted rows
    r3 = sync(client, user, r2["sync_token"], [cmd("task_delete", id=parent)])
    assert _only([t for t in r3["tasks"] if t["id"] == parent])["is_deleted"]
    assert _only([t for t in r3["tasks"] if t["id"] == child])["is_deleted"]


def test_task_reorder(client, user):
    r = sync(
        client,
        user,
        "*",
        [
            cmd("task_add", temp_id="a", title="A"),
            cmd("task_add", temp_id="b", title="B"),
            cmd("task_add", temp_id="c", title="C"),
        ],
    )
    a = r["temp_id_mapping"]["a"]
    b = r["temp_id_mapping"]["b"]
    c = r["temp_id_mapping"]["c"]
    r2 = sync(
        client,
        user,
        "*",
        [
            cmd(
                "task_reorder",
                items=[
                    {"id": a, "sort_order": 3000},
                    {"id": b, "sort_order": 1000},
                    {"id": c, "sort_order": 2000},
                ],
            )
        ],
    )
    orders = {t["id"]: t["sort_order"] for t in r2["tasks"]}
    assert orders[a] == 3000 and orders[b] == 1000 and orders[c] == 2000


def test_label_lifecycle_and_name_taken(client, user):
    r = sync(client, user, "*", [cmd("label_add", temp_id="l1", name="privat", color="amber")])
    lid = r["temp_id_mapping"]["l1"]
    label = _only(r["labels"])
    assert label["name"] == "privat" and label["color"] == "amber"

    # case-insensitive duplicate rejected
    dup = cmd("label_add", temp_id="l2", name="PRIVAT")
    r2 = sync(client, user, "*", [dup])
    assert r2["sync_status"][dup["uuid"]]["error_code"] == "name_taken"

    r3 = sync(client, user, "*", [cmd("label_update", id=lid, name="beruf", color="red")])
    assert _only([x for x in r3["labels"] if x["id"] == lid])["name"] == "beruf"

    r4 = sync(client, user, r3["sync_token"], [cmd("label_delete", id=lid)])
    assert _only([x for x in r4["labels"] if x["id"] == lid])["is_deleted"]


def test_label_assignment_and_delete_removes_from_tasks(client, user):
    r = sync(
        client,
        user,
        "*",
        [
            cmd("label_add", temp_id="l1", name="tag"),
            cmd("task_add", temp_id="t1", title="Tagged", label_ids=["l1"]),
        ],
    )
    lid = r["temp_id_mapping"]["l1"]
    tid = r["temp_id_mapping"]["t1"]
    assert _only([t for t in r["tasks"] if t["id"] == tid])["label_ids"] == [lid]

    r2 = sync(client, user, r["sync_token"], [cmd("label_delete", id=lid)])
    task = _only([t for t in r2["tasks"] if t["id"] == tid])
    assert task["label_ids"] == []


def test_temp_id_resolves_across_requests(client, user):
    # Request 1: create a project with a temp_id.
    r1 = sync(client, user, "*", [cmd("project_add", temp_id="proj-a", name="Cross")])
    assert "proj-a" in r1["temp_id_mapping"]
    real_pid = r1["temp_id_mapping"]["proj-a"]

    # Request 2 (separate call): reference that temp_id for a new task.
    add = cmd("task_add", temp_id="task-a", title="Linked", project_id="proj-a")
    r2 = sync(client, user, r1["sync_token"], [add])
    assert r2["sync_status"][add["uuid"]] == "ok"
    task = _only([t for t in r2["tasks"] if t["title"] == "Linked"])
    assert task["project_id"] == real_pid


def test_unknown_reference_is_not_found(client, user):
    add = cmd("task_update", id=str(uuid.uuid4()), title="Ghost")
    r = sync(client, user, "*", [add])
    assert r["sync_status"][add["uuid"]]["error_code"] == "not_found"


def test_invalid_color_is_invalid_args(client, user):
    add = cmd("project_add", temp_id="p", name="P", color="chartreuse")
    r = sync(client, user, "*", [add])
    assert r["sync_status"][add["uuid"]]["error_code"] == "invalid_args"


def test_temp_id_reuse_rejected_cleanly(client, user):
    """Reusing a temp_id must yield invalid_args, not a raw DB error (§5.3)."""
    r1 = sync(client, user, "*", [cmd("task_add", temp_id="reused-tmp", title="first")])
    assert list(r1["sync_status"].values())[0] == "ok"

    r2 = sync(client, user, "*", [cmd("task_add", temp_id="reused-tmp", title="second")])
    status = list(r2["sync_status"].values())[0]
    assert status["error_code"] == "invalid_args"
    assert "temp_id" in status["error"]
    assert "psycopg" not in status["error"]


# ── S9: the idempotency key is workspace-scoped ────────────────────────────
def _second_workspace(client, user) -> str:
    resp = client.post(
        "/api/v1/workspaces", headers=user["headers"], json={"name": "Second"}
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


def test_same_command_uuid_applies_in_each_workspace(client, user):
    """A uuid recorded in workspace A must not suppress it in workspace B."""
    ws_b = _second_workspace(client, user)
    shared_uuid = str(uuid.uuid4())

    a = sync(client, user, "*", [cmd("project_add", shared_uuid, temp_id="t1", name="In A")])
    assert a["sync_status"][shared_uuid] == "ok"
    id_in_a = a["temp_id_mapping"]["t1"]

    resp = client.post(
        f"/api/v1/workspaces/{ws_b}/sync",
        headers=user["headers"],
        json={
            "sync_token": "*",
            "commands": [
                {
                    "type": "project_add",
                    "uuid": shared_uuid,
                    "temp_id": "t1",
                    "args": {"name": "In B"},
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sync_status"][shared_uuid] == "ok"
    id_in_b = body["temp_id_mapping"]["t1"]

    # Two distinct objects, not workspace A's id replayed into B.
    assert id_in_b != id_in_a
    assert [p["name"] for p in body["projects"]] == ["In B"]


def test_replay_within_the_same_workspace_is_still_idempotent(client, user):
    shared_uuid = str(uuid.uuid4())
    first = sync(client, user, "*", [cmd("project_add", shared_uuid, temp_id="t1", name="Once")])
    again = sync(client, user, "*", [cmd("project_add", shared_uuid, temp_id="t1", name="Once")])
    assert again["sync_status"][shared_uuid] == "ok"
    assert again["temp_id_mapping"]["t1"] == first["temp_id_mapping"]["t1"]
    live = [p for p in again["projects"] if not p["is_deleted"]]
    assert len(live) == 1


# ── S15: task text is bounded ──────────────────────────────────────────────
def test_title_length_is_capped(client, user):
    body = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="x" * 1001)])
    status = next(iter(body["sync_status"].values()))
    assert status["error_code"] == "invalid_args"


def test_notes_length_is_capped(client, user):
    body = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="ok", notes="n" * 20_001)])
    status = next(iter(body["sync_status"].values()))
    assert status["error_code"] == "invalid_args"


def test_project_name_length_is_capped(client, user):
    body = sync(client, user, "*", [cmd("project_add", temp_id="t1", name="p" * 201)])
    status = next(iter(body["sync_status"].values()))
    assert status["error_code"] == "invalid_args"


def test_reasonable_notes_still_accepted(client, user):
    body = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="ok", notes="n" * 5000)])
    assert next(iter(body["sync_status"].values())) == "ok"


# ── I2: project_delete cascades to the comments of its tasks (§3.4) ────────
def test_project_delete_cascades_to_comments(client, user):
    body = sync(
        client,
        user,
        "*",
        [
            cmd("project_add", temp_id="p", name="Proj"),
            cmd("task_add", temp_id="t", title="In project", project_id="p"),
            cmd("task_add", temp_id="other", title="Elsewhere"),
            cmd("comment_add", temp_id="c1", task_id="t", body="on deleted task"),
            cmd("comment_add", temp_id="c2", task_id="other", body="untouched"),
        ],
    )
    assert all(s == "ok" for s in body["sync_status"].values()), body["sync_status"]
    project_id = body["temp_id_mapping"]["p"]
    doomed = body["temp_id_mapping"]["c1"]
    survivor = body["temp_id_mapping"]["c2"]
    token = body["sync_token"]

    delta = sync(client, user, token, [cmd("project_delete", id=project_id)])
    by_id = {c["id"]: c for c in delta["comments"]}
    assert by_id[doomed]["is_deleted"] is True
    assert survivor not in by_id  # unchanged, so not in the delta

    # A full sync no longer carries the cascaded comment at all.
    full = sync(client, user, "*")
    assert [c["id"] for c in full["comments"]] == [survivor]


# ── I4: a task's section must belong to the task's project ─────────────────
def _two_projects_with_a_section(client, user):
    body = sync(
        client,
        user,
        "*",
        [
            cmd("project_add", temp_id="a", name="A"),
            cmd("project_add", temp_id="b", name="B"),
            cmd("section_add", temp_id="sa", project_id="a", name="Section of A"),
        ],
    )
    m = body["temp_id_mapping"]
    return m["a"], m["b"], m["sa"], body["sync_token"]


def test_task_add_rejects_section_from_another_project(client, user):
    _a, b, section_a, token = _two_projects_with_a_section(client, user)
    body = sync(
        client, user, token,
        [cmd("task_add", temp_id="t", title="T", project_id=b, section_id=section_a)],
    )
    status = next(iter(body["sync_status"].values()))
    assert status["error_code"] == "invalid_args"


def test_task_add_rejects_section_when_task_has_no_project(client, user):
    _a, _b, section_a, token = _two_projects_with_a_section(client, user)
    body = sync(
        client, user, token, [cmd("task_add", temp_id="t", title="T", section_id=section_a)]
    )
    status = next(iter(body["sync_status"].values()))
    assert status["error_code"] == "invalid_args"


def test_task_add_accepts_section_of_its_own_project(client, user):
    a, _b, section_a, token = _two_projects_with_a_section(client, user)
    body = sync(
        client, user, token,
        [cmd("task_add", temp_id="t", title="T", project_id=a, section_id=section_a)],
    )
    assert next(iter(body["sync_status"].values())) == "ok"


def test_task_move_rejects_section_from_another_project(client, user):
    a, b, section_a, token = _two_projects_with_a_section(client, user)
    body = sync(
        client, user, token, [cmd("task_add", temp_id="t", title="T", project_id=a)]
    )
    task_id = body["temp_id_mapping"]["t"]
    body = sync(
        client, user, body["sync_token"],
        [cmd("task_move", id=task_id, project_id=b, section_id=section_a)],
    )
    status = next(iter(body["sync_status"].values()))
    assert status["error_code"] == "invalid_args"


def test_task_move_to_another_project_clears_a_stale_section(client, user):
    a, b, section_a, token = _two_projects_with_a_section(client, user)
    body = sync(
        client, user, token,
        [cmd("task_add", temp_id="t", title="T", project_id=a, section_id=section_a)],
    )
    task_id = body["temp_id_mapping"]["t"]
    body = sync(client, user, body["sync_token"], [cmd("task_move", id=task_id, project_id=b)])
    assert next(iter(body["sync_status"].values())) == "ok"
    task = next(t for t in body["tasks"] if t["id"] == task_id)
    assert task["project_id"] == b
    assert task["section_id"] is None


# ── M6: the client's calendar day drives recurrence rollover ───────────────
def test_task_complete_uses_the_clients_local_day(client, user):
    """A client ahead of UTC must not see the date jump after sync.

    The optimistic apply runs against the *device's* local day (contract §0), so
    deriving "today" from UTC alone made the two disagree for anyone far enough
    out: at 09:00 on the 24th in UTC+13 the server still sees the 23rd.
    """
    utc_today = datetime.now(UTC).date()
    tomorrow = utc_today + timedelta(days=1)

    r = sync(client, user, "*", [
        cmd("task_add", temp_id="t1", title="Daily",
            start_date=utc_today.isoformat(), recurrence="FREQ=DAILY"),
    ])
    tid = r["temp_id_mapping"]["t1"]

    r2 = sync(client, user, r["sync_token"], [
        cmd("task_complete", id=tid, today=tomorrow.isoformat()),
    ])
    task = next(t for t in r2["tasks"] if t["id"] == tid)
    assert task["start_date"] == (tomorrow + timedelta(days=1)).isoformat()


def test_task_complete_ignores_an_implausible_client_day(client, user):
    """A wrong or hostile `today` cannot push the series somewhere arbitrary."""
    utc_today = datetime.now(UTC).date()
    r = sync(client, user, "*", [
        cmd("task_add", temp_id="t1", title="Daily",
            start_date=utc_today.isoformat(), recurrence="FREQ=DAILY"),
    ])
    tid = r["temp_id_mapping"]["t1"]

    r2 = sync(client, user, r["sync_token"], [
        cmd("task_complete", id=tid, today="2035-01-01"),
    ])
    task = next(t for t in r2["tasks"] if t["id"] == tid)
    # Clamped back to UTC today, so the next occurrence is simply tomorrow.
    assert task["start_date"] == (utc_today + timedelta(days=1)).isoformat()
