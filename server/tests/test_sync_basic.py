"""Sync basics: full sync, incremental deltas, stale-token fallback."""

from __future__ import annotations

from tests.conftest import cmd, sync


def test_full_sync_empty_workspace(client, user):
    resp = sync(client, user, "*")
    assert resp["full_sync"] is True
    assert resp["projects"] == []
    assert resp["tasks"] == []
    # the owner appears as a member
    assert len(resp["members"]) == 1
    assert resp["members"][0]["role"] == "owner"
    assert resp["sync_token"] != "*"


def test_full_sync_returns_live_objects(client, user):
    sync(client, user, "*", [cmd("task_add", temp_id="t1", title="Buy milk")])
    resp = sync(client, user, "*")
    assert resp["full_sync"] is True
    titles = [t["title"] for t in resp["tasks"]]
    assert titles == ["Buy milk"]


def test_incremental_returns_only_changes(client, user):
    first = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="A")])
    token = first["sync_token"]
    # No new changes since token -> empty arrays, incremental
    empty = sync(client, user, token)
    assert empty["full_sync"] is False
    assert empty["tasks"] == []

    # Add another task; only it comes back
    second = sync(client, user, token, [cmd("task_add", temp_id="t2", title="B")])
    assert second["full_sync"] is False
    assert [t["title"] for t in second["tasks"]] == ["B"]


def test_incremental_includes_soft_deletes(client, user):
    first = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="Doomed")])
    task_id = first["temp_id_mapping"]["t1"]
    token = first["sync_token"]
    resp = sync(client, user, token, [cmd("task_delete", id=task_id)])
    deleted = [t for t in resp["tasks"] if t["id"] == task_id]
    assert deleted and deleted[0]["is_deleted"] is True


def test_full_sync_omits_deleted(client, user):
    first = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="Doomed")])
    task_id = first["temp_id_mapping"]["t1"]
    sync(client, user, first["sync_token"], [cmd("task_delete", id=task_id)])
    full = sync(client, user, "*")
    assert all(t["id"] != task_id for t in full["tasks"])


def test_stale_or_garbage_token_forces_full_sync(client, user):
    sync(client, user, "*", [cmd("task_add", temp_id="t1", title="A")])
    resp = sync(client, user, "not-a-real-token")
    assert resp["full_sync"] is True
    assert len(resp["tasks"]) == 1


# ---------------------------------------------------------------------------
# At-least-once delivery (I: incremental sync must never skip committed data)
# ---------------------------------------------------------------------------
def _commit_during_collect(monkeypatch, make_change):
    """Run `make_change` inside the sync request, right after changes are read.

    Simulates the window a concurrent writer really commits in: under READ
    COMMITTED every statement of the request sees a fresh snapshot, so anything
    that commits between "read the changes" and "read the version counter" is
    visible to the second statement but was not returned by the first.
    """
    from balu.routers import sync as sync_router

    real_collect = sync_router.collect_changes
    fired = {"done": False}

    def collect_then_commit(*args, **kwargs):
        changes = real_collect(*args, **kwargs)
        if not fired["done"]:
            fired["done"] = True
            make_change()
        return changes

    monkeypatch.setattr(sync_router, "collect_changes", collect_then_commit)
    return fired


def test_incremental_sync_never_skips_a_task_committed_mid_request(client, user, monkeypatch):
    """A second device's `task_add` landing mid-request must not be lost.

    The version counter and the row it stamps commit in one transaction, so the
    counter can only move after the row is visible - but the sync endpoint used
    to read the rows first and the counter second, handing back a token that had
    already advanced past a row it never sent. Every later incremental pull asks
    for `version > token`, so the task was skipped permanently.
    """
    first = sync(client, user, "*")
    token = first["sync_token"]

    created = {}

    def concurrent_task_add():
        # A genuine second client, with its own request and its own transaction.
        resp = sync(client, user, "*", [cmd("task_add", temp_id="race", title="From device A")])
        created["id"] = resp["temp_id_mapping"]["race"]

    _commit_during_collect(monkeypatch, concurrent_task_add)

    during = sync(client, user, token)
    monkeypatch.undo()

    assert created.get("id"), "the concurrent write did not run"
    if any(t["id"] == created["id"] for t in during["tasks"]):
        return  # delivered immediately - also correct

    later = sync(client, user, during["sync_token"])
    assert any(t["id"] == created["id"] for t in later["tasks"]), (
        "task committed mid-request was skipped forever"
    )
