"""Happy-path coverage for every command in the catalog + temp_id resolution."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from balu.models import Task
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


def test_sort_order_out_of_int32_range_is_clamped(client, user):
    for n, (bad, expected) in enumerate(
        ((3_000_000_000, 2**31 - 1), (-3_000_000_000, -(2**31)))
    ):
        add = cmd("task_add", temp_id=f"t{n}", title="Secret title", sort_order=bad)
        body = sync(client, user, "*", [add])
        assert body["sync_status"][add["uuid"]] == "ok"
        task = next(t for t in body["tasks"] if t["id"] == body["temp_id_mapping"][f"t{n}"])
        assert task["sort_order"] == expected


def test_sort_order_at_int32_bounds_accepted(client, user):
    add = cmd("task_add", temp_id="t", title="Edge", sort_order=2**31 - 1)
    body = sync(client, user, "*", [add])
    assert body["sync_status"][add["uuid"]] == "ok"


def _sort_order_commands(ids: dict, bad):
    return {
        "project_add": cmd("project_add", temp_id="np", name="P", sort_order=bad),
        "project_update": cmd("project_update", id=ids["p"], sort_order=bad),
        "section_add": cmd(
            "section_add", temp_id="ns", project_id=ids["p"], name="S", sort_order=bad
        ),
        "section_update": cmd("section_update", id=ids["s"], sort_order=bad),
        "label_add": cmd("label_add", temp_id="nl", name="L2", sort_order=bad),
        "label_update": cmd("label_update", id=ids["l"], sort_order=bad),
        "task_add": cmd("task_add", temp_id="nt", title="T2", sort_order=bad),
        "task_move": cmd("task_move", id=ids["t"], sort_order=bad),
        "task_reorder": cmd("task_reorder", items=[{"id": ids["t"], "sort_order": bad}]),
    }


@pytest.mark.parametrize(
    "bad,message",
    [
        (True, "must be an integer"),
        (1.5, "must be an integer"),
        ("12", "must be an integer"),
    ],
)
def test_sort_order_is_validated_by_every_command_that_parses_it(client, user, bad, message):
    setup = sync(client, user, "*", [
        cmd("project_add", temp_id="p", name="P0"),
        cmd("section_add", temp_id="s", project_id="p", name="S0"),
        cmd("label_add", temp_id="l", name="L0"),
        cmd("task_add", temp_id="t", title="T0"),
    ])
    ids = {k: setup["temp_id_mapping"][k] for k in ("p", "s", "l", "t")}
    for name, command in _sort_order_commands(ids, bad).items():
        body = sync(client, user, setup["sync_token"], [command])
        status = body["sync_status"][command["uuid"]]
        assert status["error_code"] == "invalid_args", name
        assert message in status["error"], name


# command -> (table in the payload, id key: an `ids` key for an update, the
# add's temp_id for an add).
_CLAMP_TARGETS = {
    "project_add": ("projects", "np"), "project_update": ("projects", "p"),
    "section_add": ("sections", "ns"), "section_update": ("sections", "s"),
    "label_add": ("labels", "nl"), "label_update": ("labels", "l"),
    "task_add": ("tasks", "nt"), "task_move": ("tasks", "t"), "task_reorder": ("tasks", "t"),
}


@pytest.mark.parametrize(
    "value,expected",
    [(3_000_000_000, 2**31 - 1), (-3_000_000_000, -(2**31))],
)
def test_sort_order_out_of_range_is_clamped_by_every_command(client, user, value, expected):
    setup = sync(client, user, "*", [
        cmd("project_add", temp_id="p", name="P0"),
        cmd("section_add", temp_id="s", project_id="p", name="S0"),
        cmd("label_add", temp_id="l", name="L0"),
        cmd("task_add", temp_id="t", title="T0"),
    ])
    ids = {k: setup["temp_id_mapping"][k] for k in ("p", "s", "l", "t")}
    token = setup["sync_token"]
    for name, command in _sort_order_commands(ids, value).items():
        body = sync(client, user, token, [command])
        token = body["sync_token"]
        assert body["sync_status"][command["uuid"]] == "ok", name
        table, key = _CLAMP_TARGETS[name]
        target = body["temp_id_mapping"].get(key) or ids[key]
        row = next(r for r in body[table] if r["id"] == target)
        assert row["sort_order"] == expected, name


def test_label_add_keeps_an_explicit_zero_sort_order(client, user):
    sync(client, user, "*", [cmd("label_add", temp_id="a", name="A", sort_order=5000)])
    add = cmd("label_add", temp_id="b", name="B", sort_order=0)
    body = sync(client, user, "*", [add])
    label = next(x for x in body["labels"] if x["id"] == body["temp_id_mapping"]["b"])
    assert label["sort_order"] == 0


def test_whole_float_sort_order_is_accepted(client, user):
    add = cmd("task_add", temp_id="t", title="Whole", sort_order=5.0)
    assert sync(client, user, "*", [add])["sync_status"][add["uuid"]] == "ok"


def test_computed_sort_order_is_capped_at_int32(client, user):
    first = cmd("task_add", temp_id="a", title="Max", sort_order=2**31 - 1)
    body = sync(client, user, "*", [first])
    second = cmd("task_add", temp_id="b", title="After")
    body = sync(client, user, body["sync_token"], [second])
    assert body["sync_status"][second["uuid"]] == "ok"
    task = next(t for t in body["tasks"] if t["id"] == body["temp_id_mapping"]["b"])
    assert task["sort_order"] == 2**31 - 1


# A subtask's project/section follow its parent (contract §3.3)
def test_task_move_to_other_project_carries_subtasks(client, user):
    body = sync(client, user, "*", [
        cmd("project_add", temp_id="pa", name="A"),
        cmd("project_add", temp_id="pb", name="B"),
        cmd("section_add", temp_id="sa", project_id="pa", name="A-sec"),
        cmd("task_add", temp_id="par", title="Parent", project_id="pa", section_id="sa"),
    ])
    m = body["temp_id_mapping"]
    body = sync(client, user, body["sync_token"], [
        cmd("task_add", temp_id="s1", title="Sub1", project_id=m["pa"], section_id=m["sa"],
            parent_task_id=m["par"]),
        cmd("task_add", temp_id="s2", title="Sub2 (no project)", parent_task_id=m["par"]),
    ])
    m.update(body["temp_id_mapping"])

    move = cmd("task_move", id=m["par"], project_id=m["pb"], section_id=None, sort_order=1000)
    body = sync(client, user, body["sync_token"], [move])
    assert body["sync_status"][move["uuid"]] == "ok"

    tasks = {t["id"]: t for t in sync(client, user, "*")["tasks"]}
    assert tasks[m["par"]]["project_id"] == m["pb"]
    for key in ("s1", "s2"):
        sub = tasks[m[key]]
        assert sub["project_id"] == m["pb"], f"{key} stayed in {sub['project_id']!r}"
        assert sub["section_id"] != m["sa"], f"{key} still points at the source project's section"


def _tree(client, user):
    body = sync(client, user, "*", [
        cmd("project_add", temp_id="pa", name="A"),
        cmd("project_add", temp_id="pb", name="B"),
        cmd("section_add", temp_id="sa", project_id="pa", name="A-sec"),
        cmd("section_add", temp_id="sb", project_id="pb", name="B-sec"),
        cmd("task_add", temp_id="par", title="Parent", project_id="pa", section_id="sa"),
        cmd("task_add", temp_id="par2", title="Parent2", project_id="pb", section_id="sb"),
    ])
    return body["temp_id_mapping"], body["sync_token"]


def _sub_add(m):
    return cmd("task_add", temp_id="s1", title="S", parent_task_id=m["par"])


def _all(client, user):
    return {t["id"]: t for t in sync(client, user, "*")["tasks"]}


def test_task_move_cascade_follows_parent_section_and_bumps_subtask_version(client, user):
    m, token = _tree(client, user)
    body = sync(client, user, token, [_sub_add(m)])
    m.update(body["temp_id_mapping"])
    assert _all(client, user)[m["s1"]]["project_id"] == m["pa"]  # task_add inherits
    token = body["sync_token"]

    move = cmd("task_move", id=m["par"], project_id=m["pb"], section_id=m["sb"])
    body = sync(client, user, token, [move])
    assert body["sync_status"][move["uuid"]] == "ok"
    pulled = {t["id"]: t for t in body["tasks"]}
    assert m["s1"] in pulled, "the subtask must be pulled by clients"
    sub = _all(client, user)[m["s1"]]
    assert (sub["project_id"], sub["section_id"]) == (m["pb"], m["sb"])


def test_task_move_cascade_leaves_deleted_subtasks_alone(client, user, db):
    m, token = _tree(client, user)
    body = sync(client, user, token, [_sub_add(m)])
    m.update(body["temp_id_mapping"])
    body = sync(client, user, body["sync_token"], [cmd("task_delete", id=m["s1"])])
    sync(client, user, body["sync_token"], [cmd("task_move", id=m["par"], project_id=m["pb"])])
    db.expire_all()
    assert str(db.get(Task, uuid.UUID(m["s1"])).project_id) == m["pa"]


def test_reparenting_a_subtask_takes_the_new_parents_project_and_section(client, user):
    m, token = _tree(client, user)
    body = sync(client, user, token, [_sub_add(m)])
    m.update(body["temp_id_mapping"])
    move = cmd("task_move", id=m["s1"], parent_task_id=m["par2"])
    body = sync(client, user, body["sync_token"], [move])
    assert body["sync_status"][move["uuid"]] == "ok"
    sub = _all(client, user)[m["s1"]]
    assert (sub["project_id"], sub["section_id"]) == (m["pb"], m["sb"])


def test_task_add_with_live_parent_ignores_the_sent_container(client, user):
    m, token = _tree(client, user)
    body = sync(client, user, token, [
        cmd("task_add", temp_id="s1", title="S", parent_task_id=m["par"], project_id=m["pb"],
            section_id=m["sb"]),
    ])
    sub = _all(client, user)[body["temp_id_mapping"]["s1"]]
    assert (sub["project_id"], sub["section_id"]) == (m["pa"], m["sa"])


def test_task_move_of_a_subtask_ignores_sent_project_and_section(client, user):
    m, token = _tree(client, user)
    body = sync(client, user, token, [_sub_add(m)])
    m.update(body["temp_id_mapping"])
    move = cmd("task_move", id=m["s1"], project_id=m["pb"], section_id=m["sb"])
    body = sync(client, user, body["sync_token"], [move])
    assert body["sync_status"][move["uuid"]] == "ok"
    sub = _all(client, user)[m["s1"]]
    assert (sub["project_id"], sub["section_id"]) == (m["pa"], m["sa"])


def test_reparenting_with_a_section_of_the_new_parent_is_not_rejected(client, user):
    m, token = _tree(client, user)
    body = sync(client, user, token, [_sub_add(m)])
    m.update(body["temp_id_mapping"])
    move = cmd("task_move", id=m["s1"], parent_task_id=m["par2"], section_id=m["sb"])
    body = sync(client, user, body["sync_token"], [move])
    assert body["sync_status"][move["uuid"]] == "ok"
    sub = _all(client, user)[m["s1"]]
    assert (sub["project_id"], sub["section_id"]) == (m["pb"], m["sb"])


def test_task_with_live_subtasks_cannot_become_a_subtask(client, user):
    m, token = _tree(client, user)
    body = sync(client, user, token, [_sub_add(m)])
    m.update(body["temp_id_mapping"])
    move = cmd("task_move", id=m["par"], parent_task_id=m["par2"])
    body = sync(client, user, body["sync_token"], [move])
    assert body["sync_status"][move["uuid"]]["error_code"] == "invalid_args"
    assert _all(client, user)[m["par"]]["parent_task_id"] is None


def test_cascade_leaves_unchanged_subtasks_versions_alone(client, user, db):
    m, token = _tree(client, user)
    body = sync(client, user, token, [
        cmd("task_add", temp_id="s1", title="S1", parent_task_id=m["par"]),
        cmd("task_add", temp_id="s2", title="S2", parent_task_id=m["par"]),
    ])
    m.update(body["temp_id_mapping"])

    def versions():
        db.expire_all()
        return {k: db.get(Task, uuid.UUID(m[k])).version for k in ("par", "s1", "s2")}

    before = versions()
    move = cmd("task_move", id=m["par"], project_id=m["pb"], section_id=m["sb"])
    body = sync(client, user, body["sync_token"], [move])
    after = versions()
    assert after["s1"] > before["s1"] and after["s2"] > before["s2"]
    # Moving to the container the subtasks are already in changes no subtask version.
    again = cmd("task_move", id=m["par"], project_id=m["pb"], section_id=m["sb"])
    sync(client, user, body["sync_token"], [again])
    final = versions()
    assert final["s1"] == after["s1"] and final["s2"] == after["s2"]
    assert final["par"] > after["par"]


def test_task_move_rejects_a_task_as_its_own_parent(client, user):
    m, token = _tree(client, user)
    mv = cmd("task_move", id=m["par"], parent_task_id=m["par"])
    body = sync(client, user, token, [mv])
    assert body["sync_status"][mv["uuid"]]["error_code"] == "invalid_args"
    assert _all(client, user)[m["par"]]["parent_task_id"] is None


def test_task_add_with_live_parent_is_not_relocated_by_a_deleted_sent_project(client, user):
    m, token = _tree(client, user)
    body = sync(client, user, token, [cmd("project_delete", id=m["pb"])])
    add = cmd("task_add", temp_id="s1", title="S", parent_task_id=m["par"],
              project_id=m["pb"], section_id=m["sb"])
    body = sync(client, user, body["sync_token"], [add])
    assert body["sync_status"][add["uuid"]] == "ok"
    assert "relocated" not in body or add["uuid"] not in (body.get("relocated") or {})
    sub = _all(client, user)[body["temp_id_mapping"]["s1"]]
    assert (sub["project_id"], sub["section_id"]) == (m["pa"], m["sa"])


def test_migration_f6a7b8c9d0e1_realigns_subtasks_and_bumps_versions(client, user, db):
    import importlib.util
    from pathlib import Path
    from types import SimpleNamespace

    from sqlalchemy import text

    from balu.db import get_engine

    m, token = _tree(client, user)
    body = sync(client, user, token, [
        cmd("task_add", temp_id="s1", title="Mismatched", parent_task_id=m["par"]),
        cmd("task_add", temp_id="s2", title="Matching", parent_task_id=m["par"]),
        cmd("task_add", temp_id="s3", title="Deleted", parent_task_id=m["par"]),
        cmd("task_add", temp_id="s4", title="Mismatched too", parent_task_id=m["par"]),
    ])
    m.update(body["temp_id_mapping"])
    sync(client, user, body["sync_token"], [cmd("task_delete", id=m["s3"])])
    ws = user["workspace_id"]
    # nesting deeper than one level, as older servers could create it
    body = sync(client, user, "*", [
        cmd("task_add", temp_id="g1", title="Grandchild"),
        cmd("task_add", temp_id="g2", title="Great-grandchild"),
        cmd("task_add", temp_id="e1", title="FormerParentS1ChildA"),
        cmd("task_add", temp_id="e2", title="FormerParentS1ChildB"),
        cmd("task_add", temp_id="f1", title="FormerParentS4ChildA"),
        cmd("task_add", temp_id="f2", title="FormerParentS4ChildB"),
        cmd("task_add", temp_id="d1", title="DeletedMiddle", parent_task_id=m["par"]),
        cmd("task_add", temp_id="d2", title="HiddenBelowDeleted"),
        cmd("task_add", temp_id="c1", title="CycleA"),
        cmd("task_add", temp_id="c2", title="CycleB"),
    ])
    m.update(body["temp_id_mapping"])
    # a second workspace holding only matching subtasks must not be bumped
    other = _second_workspace(client, user)
    resp = client.post(
        f"/api/v1/workspaces/{other}/sync",
        headers=user["headers"],
        json={"sync_token": "*", "commands": [
            cmd("task_add", temp_id="op", title="OtherParent"),
            cmd("task_add", temp_id="os", title="OtherSub", parent_task_id="op"),
        ]},
    )
    assert resp.status_code == 200, resp.text
    with get_engine().begin() as conn:
        # the pre-fix state: s1 and the deleted s3 diverged from the parent
        conn.execute(text(
            "UPDATE tasks SET project_id = :p, section_id = :sec WHERE id IN (:a, :b, :c)"
        ), {"p": m["pb"], "sec": m["sb"], "a": m["s1"], "b": m["s3"], "c": m["s4"]})
        conn.execute(text("UPDATE tasks SET parent_task_id = :par WHERE id = :g"),
                     {"par": m["s2"], "g": m["g1"]})
        conn.execute(text("UPDATE tasks SET parent_task_id = :par WHERE id = :g"),
                     {"par": m["g1"], "g": m["g2"]})
        conn.execute(text("UPDATE tasks SET sort_order = 10 WHERE id = :g"), {"g": m["g1"]})
        conn.execute(text("UPDATE tasks SET sort_order = 20 WHERE id = :g"), {"g": m["g2"]})
        # two more former parents (s1, s4) with grandchildren whose old sibling-relative
        # sort_orders interleave: 10 e1, 15 f1, 20 e2, 25 f2
        for parent, child, order in (
            ("s1", "e1", 10), ("s4", "f1", 15), ("s1", "e2", 20), ("s4", "f2", 25),
        ):
            conn.execute(
                text("UPDATE tasks SET parent_task_id = :par, sort_order = :o WHERE id = :c"),
                {"par": m[parent], "o": order, "c": m[child]},
            )
        # the former parents' own order decides the order of their groups: s2, s1, s4
        for key, order in (("s2", 1), ("s1", 2), ("s4", 3)):
            conn.execute(
                text("UPDATE tasks SET sort_order = :o WHERE id = :t"), {"o": order, "t": m[key]}
            )
        # a live row below a deleted intermediate (deleted by a one-level cascade only)
        conn.execute(text("UPDATE tasks SET is_deleted = true WHERE id = :d"), {"d": m["d1"]})
        conn.execute(text(
            "UPDATE tasks SET parent_task_id = :par, project_id = :p, section_id = :sec"
            " WHERE id = :d"
        ), {"par": m["d1"], "p": m["pb"], "sec": m["sb"], "d": m["d2"]})
        # a parent cycle: unreachable from any top-level task
        conn.execute(text("UPDATE tasks SET parent_task_id = :o, project_id = :p WHERE id = :t"),
                     {"o": m["c2"], "p": m["pb"], "t": m["c1"]})
        conn.execute(text("UPDATE tasks SET parent_task_id = :o, project_id = :p WHERE id = :t"),
                     {"o": m["c1"], "p": m["pb"], "t": m["c2"]})
        max_sort = conn.execute(text(
            "SELECT MAX(sort_order) FROM tasks WHERE parent_task_id = :par AND is_deleted = false"
            " AND id NOT IN (:g1, :g2, :e1, :e2, :f1, :f2)"
        ), {"par": m["par"], "g1": m["g1"], "g2": m["g2"], "e1": m["e1"], "e2": m["e2"],
            "f1": m["f1"], "f2": m["f2"]}).scalar_one()
        before = {
            str(r.id): tuple(r)[1:]
            for r in conn.execute(text(
                "SELECT id, parent_task_id, project_id, section_id, sort_order, version"
                " FROM tasks WHERE id IN (:d2, :c1, :c2)"
            ), {"d2": m["d2"], "c1": m["c1"], "c2": m["c2"]})
        }
        other_version = conn.execute(
            text("SELECT version FROM workspaces WHERE id = :w"), {"w": other}
        ).scalar_one()
        ws_version = conn.execute(
            text("SELECT version FROM workspaces WHERE id = :w"), {"w": ws}
        ).scalar_one()
        s2_version = conn.execute(
            text("SELECT version FROM tasks WHERE id = :t"), {"t": m["s2"]}
        ).scalar_one()

    path = next(
        (Path(__file__).resolve().parent.parent / "alembic" / "versions").glob(
            "f6a7b8c9d0e1_*.py"
        )
    )
    spec = importlib.util.spec_from_file_location("mig_f6a7", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    with get_engine().begin() as conn:
        mod.op = SimpleNamespace(execute=lambda sql: conn.execute(text(str(sql))))
        mod.upgrade()
        mod.upgrade()  # idempotent: the second run changes nothing (and terminates on the cycle)

    with get_engine().begin() as conn:
        rows = {
            str(r.id): r
            for r in conn.execute(text(
                "SELECT id, project_id, section_id, version, parent_task_id, sort_order,"
                " is_deleted FROM tasks"
            ))
        }
        new_ws_version = conn.execute(
            text("SELECT version FROM workspaces WHERE id = :w"), {"w": ws}
        ).scalar_one()
        new_other_version = conn.execute(
            text("SELECT version FROM workspaces WHERE id = :w"), {"w": other}
        ).scalar_one()
    # two mismatched subtasks plus the deep ones, one bump for the workspace
    assert new_ws_version == ws_version + 1
    assert new_other_version == other_version
    s4 = rows[m["s4"]]
    assert (str(s4.project_id), str(s4.section_id)) == (m["pa"], m["sa"])
    assert s4.version == new_ws_version
    s1 = rows[m["s1"]]
    assert (str(s1.project_id), str(s1.section_id)) == (m["pa"], m["sa"])
    assert s1.version == new_ws_version
    assert rows[m["s2"]].version == s2_version
    # flattened onto the top-level ancestor, then aligned
    for g in ("g1", "g2", "e1", "e2", "f1", "f2"):
        row = rows[m[g]]
        assert str(row.parent_task_id) == m["par"]
        assert (str(row.project_id), str(row.section_id)) == (m["pa"], m["sa"])
        assert row.version == new_ws_version
    # appended after the root's own subtasks, in their old relative order
    assert rows[m["g1"]].sort_order == max_sort + 1000
    assert rows[m["g2"]].sort_order == max_sort + 2000
    # depth-first: each former parent's group stays together (no e/f interleaving)
    assert [rows[m[k]].sort_order for k in ("e1", "e2", "f1", "f2")] == [
        max_sort + 3000, max_sort + 4000, max_sort + 5000, max_sort + 6000,
    ]
    assert str(rows[m["s3"]].project_id) == m["pb"]  # deleted: untouched
    # a live row under a deleted intermediate is not resurrected; a cycle is left alone
    for key in ("d2", "c1", "c2"):
        row = rows[m[key]]
        assert (
            row.parent_task_id, row.project_id, row.section_id, row.sort_order, row.version
        ) == before[m[key]]
    assert rows[m["d1"]].is_deleted


def test_task_reorder_skips_a_task_of_another_workspace(client, user):
    other = _second_workspace(client, user)
    resp = client.post(
        f"/api/v1/workspaces/{other}/sync",
        headers=user["headers"],
        json={"sync_token": "*", "commands": [cmd("task_add", temp_id="x", title="Foreign")]},
    )
    assert resp.status_code == 200, resp.text
    foreign = resp.json()["temp_id_mapping"]["x"]
    body = sync(client, user, "*", [cmd("task_add", temp_id="a", title="A")])
    a = body["temp_id_mapping"]["a"]
    reorder = cmd("task_reorder", items=[
        {"id": foreign, "sort_order": 9000}, {"id": a, "sort_order": 4000},
    ])
    body = sync(client, user, body["sync_token"], [reorder])
    assert body["sync_status"][reorder["uuid"]] == "ok"
    assert _all(client, user)[a]["sort_order"] == 4000
    check = client.post(
        f"/api/v1/workspaces/{other}/sync",
        headers=user["headers"],
        json={"sync_token": "*", "commands": []},
    ).json()
    assert next(t for t in check["tasks"] if t["id"] == foreign)["sort_order"] != 9000
