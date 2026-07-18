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
