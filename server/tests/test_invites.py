"""Invite create/list/revoke/accept (§7)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from balu.models import Invite
from tests.conftest import auth_headers, register_user, sync


def _second_user(client) -> dict:
    data = register_user(client, email=None, name="Otto")
    return {
        "user": data["user"],
        "access_token": data["access_token"],
        "headers": auth_headers(data["access_token"]),
    }


def _create_invite(client, user, role="member", email=None) -> dict:
    resp = client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/invites",
        headers=user["headers"],
        json={"role": role, "email": email},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_create_invite_returns_token(client, user):
    body = _create_invite(client, user, role="admin", email="a@example.com")
    assert body["role"] == "admin"
    assert body["email"] == "a@example.com"
    assert body["token"]
    assert body["expires_at"]


def test_create_invite_requires_admin(client, user):
    # A viewer/member cannot create invites. Make a member via invite+accept.
    invite = _create_invite(client, user, role="member")
    member = _second_user(client)
    client.post(
        "/api/v1/invites/accept",
        headers=member["headers"],
        json={"token": invite["token"]},
    )
    resp = client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/invites",
        headers=member["headers"],
        json={"role": "member"},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "forbidden"


def test_list_invites_pending_only(client, user):
    i1 = _create_invite(client, user, role="member")
    i2 = _create_invite(client, user, role="viewer")
    # Revoke one -> it drops out of the pending list.
    client.delete(
        f"/api/v1/workspaces/{user['workspace_id']}/invites/{i2['id']}",
        headers=user["headers"],
    )
    resp = client.get(
        f"/api/v1/workspaces/{user['workspace_id']}/invites", headers=user["headers"]
    )
    assert resp.status_code == 200
    ids = {i["id"] for i in resp.json()["invites"]}
    assert i1["id"] in ids
    assert i2["id"] not in ids


def test_accept_invite_adds_member_with_role(client, user):
    invite = _create_invite(client, user, role="admin")
    member = _second_user(client)
    resp = client.post(
        "/api/v1/invites/accept", headers=member["headers"], json={"token": invite["token"]}
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == user["workspace_id"]

    me = client.get("/api/v1/me", headers=member["headers"]).json()
    roles = {m["workspace"]["id"]: m["role"] for m in me["memberships"]}
    assert roles[user["workspace_id"]] == "admin"


def test_accept_invite_idempotent(client, user):
    invite = _create_invite(client, user, role="member")
    member = _second_user(client)
    first = client.post(
        "/api/v1/invites/accept", headers=member["headers"], json={"token": invite["token"]}
    )
    second = client.post(
        "/api/v1/invites/accept", headers=member["headers"], json={"token": invite["token"]}
    )
    assert first.status_code == 200
    assert second.status_code == 200
    me = client.get("/api/v1/me", headers=member["headers"]).json()
    count = sum(1 for m in me["memberships"] if m["workspace"]["id"] == user["workspace_id"])
    assert count == 1


def test_accept_revoked_invite(client, user):
    invite = _create_invite(client, user, role="member")
    client.delete(
        f"/api/v1/workspaces/{user['workspace_id']}/invites/{invite['id']}",
        headers=user["headers"],
    )
    member = _second_user(client)
    resp = client.post(
        "/api/v1/invites/accept", headers=member["headers"], json={"token": invite["token"]}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "invalid_token"


def test_accept_expired_invite(client, user, db):
    invite = _create_invite(client, user, role="member")
    # Backdate the expiry directly.
    row = db.execute(
        select(Invite).where(Invite.workspace_id == user["workspace_id"])
    ).scalar_one()
    row.expires_at = datetime.now(UTC) - timedelta(days=1)
    db.commit()

    member = _second_user(client)
    resp = client.post(
        "/api/v1/invites/accept", headers=member["headers"], json={"token": invite["token"]}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "invalid_token"


def test_accept_unknown_token(client, user):
    member = _second_user(client)
    resp = client.post(
        "/api/v1/invites/accept", headers=member["headers"], json={"token": "not-a-real-token"}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "invalid_token"


def test_accept_bumps_version_visible_via_sync(client, user):
    # Owner establishes a sync token, then a new member joins.
    token = sync(client, user, "*")["sync_token"]
    invite = _create_invite(client, user, role="member")
    member = _second_user(client)
    client.post(
        "/api/v1/invites/accept", headers=member["headers"], json={"token": invite["token"]}
    )
    # Owner's incremental sync now carries the new member.
    delta = sync(client, user, token)
    new_ids = {m["id"] for m in delta["members"]}
    assert member["user"]["id"] in new_ids
    joined = next(m for m in delta["members"] if m["id"] == member["user"]["id"])
    assert joined["role"] == "member"
    assert joined["is_deleted"] is False
