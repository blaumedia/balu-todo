"""Workspace REST: create, update (role-gated), delete (owner-gated)."""

from __future__ import annotations

from tests.conftest import register_user


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
