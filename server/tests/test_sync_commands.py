"""Happy-path coverage for every command in the catalog + temp_id resolution."""

from __future__ import annotations

import uuid

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
