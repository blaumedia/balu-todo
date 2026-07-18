"""Member role management + removal (§7)."""

from __future__ import annotations

from tests.conftest import auth_headers, register_user, sync


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


def test_update_member_role(client, user):
    member = _join(client, user, role="member")
    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{member['user']['id']}",
        headers=user["headers"],
        json={"role": "admin"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_update_role_requires_admin(client, user):
    member = _join(client, user, role="member")
    other = _join(client, user, role="member")
    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{other['user']['id']}",
        headers=member["headers"],
        json={"role": "admin"},
    )
    assert resp.status_code == 403


def test_last_owner_cannot_be_demoted(client, user):
    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{user['user']['id']}",
        headers=user["headers"],
        json={"role": "member"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "last_owner"


def test_last_owner_cannot_be_removed(client, user):
    resp = client.delete(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{user['user']['id']}",
        headers=user["headers"],
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "last_owner"


def test_owner_demotable_when_second_owner_exists(client, user):
    member = _join(client, user, role="member")
    # Promote member to owner, then original owner can be demoted.
    client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{member['user']['id']}",
        headers=user["headers"],
        json={"role": "owner"},
    )
    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{user['user']['id']}",
        headers=user["headers"],
        json={"role": "admin"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_remove_member_surfaces_via_sync(client, user):
    token = sync(client, user, "*")["sync_token"]
    member = _join(client, user, role="member")
    resp = client.delete(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{member['user']['id']}",
        headers=user["headers"],
    )
    assert resp.status_code == 204
    delta = sync(client, user, token)
    removed = next(m for m in delta["members"] if m["id"] == member["user"]["id"])
    assert removed["is_deleted"] is True


def test_removed_member_forbidden_on_sync(client, user):
    member = _join(client, user, role="member")
    client.delete(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{member['user']['id']}",
        headers=user["headers"],
    )
    resp = client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/sync",
        headers=member["headers"],
        json={"sync_token": "*", "commands": []},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "forbidden"


def test_self_leave(client, user):
    member = _join(client, user, role="member")
    resp = client.delete(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{member['user']['id']}",
        headers=member["headers"],
    )
    assert resp.status_code == 204
    # The workspace disappears from the leaver's boot call.
    me = client.get("/api/v1/me", headers=member["headers"]).json()
    ids = {m["workspace"]["id"] for m in me["memberships"]}
    assert user["workspace_id"] not in ids


def test_non_admin_cannot_remove_other(client, user):
    member = _join(client, user, role="member")
    other = _join(client, user, role="member")
    resp = client.delete(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{other['user']['id']}",
        headers=member["headers"],
    )
    assert resp.status_code == 403
