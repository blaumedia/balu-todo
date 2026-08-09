"""Workspace REST: create, update (role-gated), delete (owner-gated)."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from balu.models import Membership, Project, Task
from tests.conftest import auth_headers, cmd, register_user


def _join(client, owner, role="member") -> dict:
    """Register a fresh user and have them accept an invite into owner's workspace."""
    invite = client.post(
        f"/api/v1/workspaces/{owner['workspace_id']}/invites",
        headers=owner["headers"],
        json={"role": role},
    ).json()["invite"]
    data = register_user(client, email=None, name="Otto")
    member = {
        "user": data["user"],
        "access_token": data["access_token"],
        "headers": auth_headers(data["access_token"]),
        "workspace_id": owner["workspace_id"],
    }
    resp = client.post(
        "/api/v1/invites/accept", headers=member["headers"], json={"token": invite["token"]}
    )
    assert resp.status_code == 200
    return member


def test_create_workspace(client, user):
    resp = client.post("/api/v1/workspaces", headers=user["headers"], json={"name": "Team"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Team"
    assert body["id"]

    me = client.get("/api/v1/me", headers=user["headers"]).json()
    names = {m["workspace"]["name"] for m in me["memberships"]}
    assert "Team" in names
    roles = {m["workspace"]["name"]: m["role"] for m in me["memberships"]}
    assert roles["Team"] == "owner"


def test_update_workspace_name(client, user):
    ws_id = user["workspace_id"]
    resp = client.patch(
        f"/api/v1/workspaces/{ws_id}", headers=user["headers"], json={"name": "Renamed"}
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


def test_delete_workspace(client, user):
    ws = client.post("/api/v1/workspaces", headers=user["headers"], json={"name": "Temp"}).json()
    resp = client.delete(f"/api/v1/workspaces/{ws['id']}", headers=user["headers"])
    assert resp.status_code == 204
    me = client.get("/api/v1/me", headers=user["headers"]).json()
    ids = {m["workspace"]["id"] for m in me["memberships"]}
    assert ws["id"] not in ids


def test_delete_last_workspace_creates_default(client, user):
    """An account without a workspace has nowhere to boot into, so one is remade."""
    resp = client.delete(f"/api/v1/workspaces/{user['workspace_id']}", headers=user["headers"])
    assert resp.status_code == 204

    me = client.get("/api/v1/me", headers=user["headers"]).json()
    assert len(me["memberships"]) == 1
    fresh = me["memberships"][0]
    assert fresh["role"] == "owner"
    assert fresh["workspace"]["id"] != user["workspace_id"]
    # Same naming rule as registration: the account name, in full.
    assert fresh["workspace"]["name"] == "Dennis"


def test_delete_workspace_non_owner_forbidden(client, user):
    admin = _join(client, user, role="admin")
    resp = client.delete(f"/api/v1/workspaces/{user['workspace_id']}", headers=admin["headers"])
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "forbidden"
    # The workspace is still there for its owner.
    me = client.get("/api/v1/me", headers=user["headers"]).json()
    assert user["workspace_id"] in {m["workspace"]["id"] for m in me["memberships"]}


def test_delete_shared_workspace_rescues_memberless_member(client, user):
    """The rescue covers every member, not just the owner who pressed delete."""
    member = _join(client, user, role="member")
    # Strip the member down to the shared workspace only.
    own = next(
        m["workspace"]["id"]
        for m in client.get("/api/v1/me", headers=member["headers"]).json()["memberships"]
        if m["workspace"]["id"] != user["workspace_id"]
    )
    assert client.delete(f"/api/v1/workspaces/{own}", headers=member["headers"]).status_code == 204

    resp = client.delete(f"/api/v1/workspaces/{user['workspace_id']}", headers=user["headers"])
    assert resp.status_code == 204

    me = client.get("/api/v1/me", headers=member["headers"]).json()
    assert len(me["memberships"]) == 1
    assert me["memberships"][0]["role"] == "owner"
    assert me["memberships"][0]["workspace"]["name"] == "Otto"


def test_delete_workspace_cascade(client, user, db):
    def _rows(model, workspace_id: str) -> int:
        return db.execute(
            select(func.count())
            .select_from(model)
            .where(model.workspace_id == uuid.UUID(workspace_id))
        ).scalar_one()

    doomed = client.post(
        "/api/v1/workspaces", headers=user["headers"], json={"name": "Temp"}
    ).json()
    resp = client.post(
        f"/api/v1/workspaces/{doomed['id']}/sync",
        headers=user["headers"],
        json={
            "sync_token": "*",
            "commands": [
                cmd("project_add", temp_id="p1", name="Doomed project"),
                cmd("task_add", temp_id="t1", title="Doomed task"),
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    assert _rows(Project, doomed["id"]) == 1
    assert _rows(Task, doomed["id"]) == 1

    assert (
        client.delete(f"/api/v1/workspaces/{doomed['id']}", headers=user["headers"]).status_code
        == 204
    )

    # The contents are really gone, not merely unreachable: orphaned rows would
    # still answer these counts.
    assert _rows(Project, doomed["id"]) == 0
    assert _rows(Task, doomed["id"]) == 0
    assert _rows(Membership, doomed["id"]) == 0

    gone = client.post(
        f"/api/v1/workspaces/{doomed['id']}/sync",
        headers=user["headers"],
        json={"sync_token": "*", "commands": []},
    )
    assert gone.status_code == 404
    assert gone.json()["detail"]["code"] == "not_found"

    # The user's original workspace is untouched - and no default was minted.
    me = client.get("/api/v1/me", headers=user["headers"]).json()
    assert [m["workspace"]["id"] for m in me["memberships"]] == [user["workspace_id"]]


def test_non_member_cannot_touch_workspace(client, user):
    other = register_user(client, email="other@example.com")
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}",
        headers=other_headers,
        json={"name": "Hijack"},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "not_found"


def test_update_missing_workspace(client, user):
    resp = client.patch(
        "/api/v1/workspaces/00000000-0000-0000-0000-000000000000",
        headers=user["headers"],
        json={"name": "X"},
    )
    assert resp.status_code == 404
