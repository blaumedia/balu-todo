"""Member role management + removal (§7)."""

from __future__ import annotations

import pytest

from balu.sync.engine import ROLE_RANK
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


# ── S10: only an owner may grant/revoke `owner`, and nobody may act on a
#         member of equal-or-higher rank (contract §7) ──────────────────────
def test_admin_cannot_promote_to_owner(client, user):
    admin = _join(client, user, role="admin")
    other = _join(client, user, role="member")
    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{other['user']['id']}",
        headers=admin["headers"],
        json={"role": "owner"},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "forbidden"


def test_admin_cannot_promote_self_to_owner(client, user):
    admin = _join(client, user, role="admin")
    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{admin['user']['id']}",
        headers=admin["headers"],
        json={"role": "owner"},
    )
    assert resp.status_code == 403


def test_admin_cannot_demote_owner(client, user):
    admin = _join(client, user, role="admin")
    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{user['user']['id']}",
        headers=admin["headers"],
        json={"role": "member"},
    )
    assert resp.status_code == 403


def test_admin_may_demote_a_peer_admin(client, user):
    """§7 forbids acting on a *higher* rank, not on a peer.

    Forbidding peers looked safer but made a co-owner impossible to remove
    through the API (only they could step down). Peer actions are lateral — they
    grant the actor nothing — and an owner can always undo one.
    """
    admin = _join(client, user, role="admin")
    peer = _join(client, user, role="admin")
    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{peer['user']['id']}",
        headers=admin["headers"],
        json={"role": "member"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "member"


def test_admin_cannot_remove_owner(client, user):
    admin = _join(client, user, role="admin")
    resp = client.delete(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{user['user']['id']}",
        headers=admin["headers"],
    )
    assert resp.status_code == 403


def test_admin_may_remove_a_peer_admin(client, user):
    admin = _join(client, user, role="admin")
    peer = _join(client, user, role="admin")
    resp = client.delete(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{peer['user']['id']}",
        headers=admin["headers"],
    )
    assert resp.status_code == 204


def test_owner_can_remove_a_co_owner(client, user):
    """Regression: the strict rank rule left a departed co-owner irremovable.

    With `<=`, owner-on-owner was refused, so the only way out was for that owner
    to step down themselves — no recourse if they had left the company.
    """
    co_owner = _join(client, user, role="admin")
    ws = user["workspace_id"]
    promote = client.patch(
        f"/api/v1/workspaces/{ws}/members/{co_owner['user']['id']}",
        headers=user["headers"],
        json={"role": "owner"},
    )
    assert promote.status_code == 200

    resp = client.delete(
        f"/api/v1/workspaces/{ws}/members/{co_owner['user']['id']}",
        headers=user["headers"],
    )
    assert resp.status_code == 204


def test_owner_can_demote_a_co_owner(client, user):
    co_owner = _join(client, user, role="admin")
    ws = user["workspace_id"]
    client.patch(
        f"/api/v1/workspaces/{ws}/members/{co_owner['user']['id']}",
        headers=user["headers"],
        json={"role": "owner"},
    )
    resp = client.patch(
        f"/api/v1/workspaces/{ws}/members/{co_owner['user']['id']}",
        headers=user["headers"],
        json={"role": "member"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "member"


def test_admin_can_still_manage_members_below(client, user):
    admin = _join(client, user, role="admin")
    member = _join(client, user, role="member")
    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{member['user']['id']}",
        headers=admin["headers"],
        json={"role": "viewer"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "viewer"
    resp = client.delete(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{member['user']['id']}",
        headers=admin["headers"],
    )
    assert resp.status_code == 204


def test_admin_can_still_leave(client, user):
    admin = _join(client, user, role="admin")
    resp = client.delete(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{admin['user']['id']}",
        headers=admin["headers"],
    )
    assert resp.status_code == 204


# ── The rank lattice, asserted as a table ──────────────────────────────────
# `packages/domain/test/memberRules.test.ts` asserts the same table from the
# client side. If either lattice drifts, one of the two suites fails.
def _join_as(client, owner, role: str) -> dict:
    """Join at `role`. Invites cannot carry `owner` (§7), so promote afterwards."""
    if role != "owner":
        return _join(client, owner, role=role)
    member = _join(client, owner, role="admin")
    resp = client.patch(
        f"/api/v1/workspaces/{owner['workspace_id']}/members/{member['user']['id']}",
        headers=owner["headers"],
        json={"role": "owner"},
    )
    assert resp.status_code == 200, resp.json()
    return member


@pytest.mark.parametrize("actor_role", ["viewer", "member", "admin", "owner"])
@pytest.mark.parametrize("target_role", ["viewer", "member", "admin", "owner"])
def test_rank_lattice(client, user, actor_role, target_role):
    """Acting on a *higher* rank is refused; peers and below are allowed."""
    expected_allowed = (
        ROLE_RANK[actor_role] >= ROLE_RANK["admin"]
        and ROLE_RANK[actor_role] >= ROLE_RANK[target_role]
    )
    actor = _join_as(client, user, actor_role)
    target = _join_as(client, user, target_role)
    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{target['user']['id']}",
        headers=actor["headers"],
        json={"role": "member"},
    )
    if expected_allowed:
        # `owner` targets are the one case that can also trip the last-owner
        # guard; the fixture owner still exists, so this stays a 200.
        assert resp.status_code == 200, f"{actor_role} -> {target_role}: {resp.json()}"
    else:
        assert resp.status_code == 403, f"{actor_role} -> {target_role}: {resp.json()}"


def test_only_an_owner_may_grant_owner(client, user):
    admin = _join(client, user, role="admin")
    target = _join(client, user, role="member")
    ws = user["workspace_id"]
    denied = client.patch(
        f"/api/v1/workspaces/{ws}/members/{target['user']['id']}",
        headers=admin["headers"],
        json={"role": "owner"},
    )
    assert denied.status_code == 403

    granted = client.patch(
        f"/api/v1/workspaces/{ws}/members/{target['user']['id']}",
        headers=user["headers"],  # the workspace owner
        json={"role": "owner"},
    )
    assert granted.status_code == 200
    assert granted.json()["role"] == "owner"


def test_member_cannot_change_own_role(client, user):
    """PATCH checks admin rank *before* the self-allowance (§7).

    `packages/domain/test/memberRules.test.ts` transcribes this rule for the UI;
    without a server-side case the two suites only asserted it from one side, so
    a drift here would have gone unnoticed.
    """
    member = _join(client, user, role="member")
    resp = client.patch(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{member['user']['id']}",
        headers=member["headers"],
        json={"role": "admin"},
    )
    assert resp.status_code == 403


def test_member_may_still_leave(client, user):
    """DELETE, by contrast, allows self unconditionally — leaving needs no rank."""
    member = _join(client, user, role="member")
    resp = client.delete(
        f"/api/v1/workspaces/{user['workspace_id']}/members/{member['user']['id']}",
        headers=member["headers"],
    )
    assert resp.status_code == 204
