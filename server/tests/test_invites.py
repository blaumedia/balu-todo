"""Invite create/list/revoke/accept (§7)."""

from __future__ import annotations

import uuid
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
    return resp.json()["invite"]


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
    assert resp.json()["workspace"]["id"] == user["workspace_id"]

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


# ── S11: an invite carrying an email only admits that address ──────────────
def test_targeted_invite_rejects_other_user(client, user):
    other = _second_user(client)
    invite = _create_invite(client, user, email="someone-else@example.com")
    resp = client.post(
        "/api/v1/invites/accept", headers=other["headers"], json={"token": invite["token"]}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "invalid_token"
    # And no membership was created.
    me = client.get("/api/v1/me", headers=other["headers"]).json()
    joined = {m["workspace"]["id"] for m in me["memberships"]}
    assert user["workspace_id"] not in joined


def test_targeted_invite_accepts_matching_user(client, user):
    other = _second_user(client)
    invite = _create_invite(client, user, email=other["user"]["email"].upper())
    resp = client.post(
        "/api/v1/invites/accept", headers=other["headers"], json={"token": invite["token"]}
    )
    assert resp.status_code == 200


def test_untargeted_invite_still_open(client, user):
    other = _second_user(client)
    invite = _create_invite(client, user, email=None)
    resp = client.post(
        "/api/v1/invites/accept", headers=other["headers"], json={"token": invite["token"]}
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Lock-order races: each request waits at the workspace lock held by `s0`.
# ---------------------------------------------------------------------------
def _accept(client, member, token):
    return client.post(
        "/api/v1/invites/accept", headers=member["headers"], json={"token": token}
    )


def _me_ws_ids(client, who) -> set[str]:
    me = client.get("/api/v1/me", headers=who["headers"]).json()
    return {m["workspace"]["id"] for m in me["memberships"]}


def test_concurrent_double_accept_creates_one_membership(client, user):
    from sqlalchemy import func

    from balu.db import get_sessionmaker
    from balu.models import Membership
    from balu.sync.engine import bump_version
    from tests.conftest import Background, wait_for_lock_waiters

    invite = _create_invite(client, user)
    member = _second_user(client)
    ws = uuid.UUID(user["workspace_id"])
    with get_sessionmaker()() as s0:
        bump_version(s0, ws)
        a = Background(lambda: _accept(client, member, invite["token"]))
        b = Background(lambda: _accept(client, member, invite["token"]))
        wait_for_lock_waiters(2)
        s0.commit()
    for resp in (a.result(), b.result()):
        assert resp.status_code == 200, resp.text
        assert resp.json()["workspace"]["id"] == user["workspace_id"]
    with get_sessionmaker()() as s:
        count = s.execute(
            select(func.count())
            .select_from(Membership)
            .where(
                Membership.workspace_id == ws,
                Membership.user_id == uuid.UUID(member["user"]["id"]),
            )
        ).scalar_one()
    assert count == 1


def test_accept_waits_for_an_uncommitted_revoke(client, user):
    from sqlalchemy import text

    from balu.db import get_sessionmaker
    from balu.sync.engine import bump_version
    from tests.conftest import Background, wait_for_lock_waiters

    invite = _create_invite(client, user)
    member = _second_user(client)
    ws = uuid.UUID(user["workspace_id"])
    with get_sessionmaker()() as s0:
        bump_version(s0, ws)
        s0.execute(
            text("UPDATE invites SET revoked = true WHERE id = :i"),
            {"i": uuid.UUID(invite["id"])},
        )
        bg = Background(lambda: _accept(client, member, invite["token"]))
        wait_for_lock_waiters(1)
        s0.commit()
    resp = bg.result()
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "invalid_token"
    assert user["workspace_id"] not in _me_ws_ids(client, member)


def test_accept_waits_for_an_uncommitted_workspace_delete(client, user):
    from sqlalchemy import text

    from balu.db import get_sessionmaker
    from balu.sync.engine import bump_version
    from tests.conftest import Background, wait_for_lock_waiters

    invite = _create_invite(client, user)
    member = _second_user(client)
    ws = uuid.UUID(user["workspace_id"])
    before = _me_ws_ids(client, member)
    with get_sessionmaker()() as s0:
        bump_version(s0, ws)
        s0.execute(text("DELETE FROM workspaces WHERE id = :w"), {"w": ws})
        bg = Background(lambda: _accept(client, member, invite["token"]))
        wait_for_lock_waiters(1)
        s0.commit()
    resp = bg.result()
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "invalid_token"
    after = _me_ws_ids(client, member)
    assert after == before
    assert len(after) == 1


def test_revoke_takes_the_workspace_lock(client, user):
    from balu.db import get_sessionmaker
    from balu.sync.engine import bump_version
    from tests.conftest import Background, wait_for_lock_waiters

    invite = _create_invite(client, user)
    ws = uuid.UUID(user["workspace_id"])
    with get_sessionmaker()() as s0:
        bump_version(s0, ws)
        bg = Background(
            lambda: client.delete(
                f"/api/v1/workspaces/{user['workspace_id']}/invites/{invite['id']}",
                headers=user["headers"],
            )
        )
        wait_for_lock_waiters(1)
        s0.commit()
    assert bg.result().status_code == 204


def test_create_invite_by_an_admin_demoted_meanwhile_is_forbidden(client, user):
    from sqlalchemy import func, text

    from balu.db import get_sessionmaker
    from balu.models import Invite
    from balu.sync.engine import bump_version
    from tests.conftest import Background, wait_for_lock_waiters

    invite = _create_invite(client, user, role="admin")
    admin = _second_user(client)
    assert _accept(client, admin, invite["token"]).status_code == 200
    ws = uuid.UUID(user["workspace_id"])

    def invite_count() -> int:
        with get_sessionmaker()() as s:
            return s.execute(
                select(func.count()).select_from(Invite).where(Invite.workspace_id == ws)
            ).scalar_one()

    before = invite_count()
    with get_sessionmaker()() as s0:
        bump_version(s0, ws)
        s0.execute(
            text("UPDATE memberships SET role = 'member' WHERE workspace_id = :w AND user_id = :u"),
            {"w": ws, "u": uuid.UUID(admin["user"]["id"])},
        )
        bg = Background(
            lambda: client.post(
                f"/api/v1/workspaces/{user['workspace_id']}/invites",
                headers=admin["headers"],
                json={"role": "member"},
            )
        )
        wait_for_lock_waiters(1)
        s0.commit()
    resp = bg.result()
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "forbidden"
    assert invite_count() == before
