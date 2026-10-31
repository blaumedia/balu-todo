"""Workspace REST: create, update (role-gated), delete (owner-gated)."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from balu.models import Membership, Project, Task
from tests.conftest import auth_headers, cmd, register_user, strand


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


def _own_ws(client, who, shared_ws: str) -> str:
    me = client.get("/api/v1/me", headers=who["headers"]).json()
    return next(
        m["workspace"]["id"] for m in me["memberships"] if m["workspace"]["id"] != shared_ws
    )


def test_delete_waits_for_an_uncommitted_accept_and_rescues_the_new_member(client, user):
    from balu.db import get_sessionmaker
    from balu.sync.engine import bump_version
    from tests.conftest import Background, wait_for_lock_waiters

    nina = register_user(client, email=None, name="Nina")
    nina_headers = auth_headers(nina["access_token"])
    me = client.get("/api/v1/me", headers=nina_headers).json()
    strand(uuid.UUID(me["memberships"][0]["workspace"]["id"]))
    ws = uuid.UUID(user["workspace_id"])
    with get_sessionmaker()() as s0:
        v = bump_version(s0, ws)
        s0.add(
            Membership(
                workspace_id=ws, user_id=uuid.UUID(nina["user"]["id"]), role="member", version=v
            )
        )
        s0.flush()
        bg = Background(
            lambda: client.delete(f"/api/v1/workspaces/{ws}", headers=user["headers"])
        )
        wait_for_lock_waiters(1)
        s0.commit()
    assert bg.result().status_code == 204
    me = client.get("/api/v1/me", headers=nina_headers).json()
    assert len(me["memberships"]) == 1
    assert me["memberships"][0]["role"] == "owner"
    assert me["memberships"][0]["workspace"]["name"] == "Nina"


def test_delete_waits_for_a_members_uncommitted_leave_elsewhere(client, user):
    from sqlalchemy import text

    from balu.db import get_sessionmaker
    from balu.sync.engine import bump_version
    from tests.conftest import Background, wait_for_lock_waiters

    otto = _join(client, user)
    own = uuid.UUID(_own_ws(client, otto, user["workspace_id"]))
    ws = uuid.UUID(user["workspace_id"])
    with get_sessionmaker()() as s0:
        # Otto deleting his own workspace P, uncommitted.
        bump_version(s0, own)
        s0.execute(
            text("SELECT id FROM users WHERE id = :u FOR NO KEY UPDATE"),
            {"u": uuid.UUID(otto["user"]["id"])},
        )
        s0.execute(text("DELETE FROM workspaces WHERE id = :p"), {"p": own})
        s0.flush()
        bg = Background(
            lambda: client.delete(f"/api/v1/workspaces/{ws}", headers=user["headers"])
        )
        wait_for_lock_waiters(1)
        s0.commit()
    assert bg.result().status_code == 204
    me = client.get("/api/v1/me", headers=otto["headers"]).json()
    assert len(me["memberships"]) == 1
    assert me["memberships"][0]["role"] == "owner"
    assert me["memberships"][0]["workspace"]["name"] == "Otto"


def test_rename_waits_for_an_uncommitted_delete(client, user):
    from sqlalchemy import text

    from balu.db import get_sessionmaker
    from tests.conftest import Background, wait_for_lock_waiters

    ws = uuid.UUID(user["workspace_id"])
    with get_sessionmaker()() as s0:
        s0.execute(text("DELETE FROM workspaces WHERE id = :w"), {"w": ws})
        bg = Background(
            lambda: client.patch(
                f"/api/v1/workspaces/{ws}", headers=user["headers"], json={"name": "New"}
            )
        )
        wait_for_lock_waiters(1)
        s0.commit()
    resp = bg.result()
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "not_found"


def test_rename_by_an_admin_demoted_meanwhile_is_forbidden(client, user):
    from sqlalchemy import text

    from balu.db import get_sessionmaker
    from balu.sync.engine import bump_version
    from tests.conftest import Background, wait_for_lock_waiters

    admin = _join(client, user, role="admin")
    ws = uuid.UUID(user["workspace_id"])
    old_name = next(
        m["workspace"]["name"]
        for m in client.get("/api/v1/me", headers=user["headers"]).json()["memberships"]
        if m["workspace"]["id"] == user["workspace_id"]
    )
    with get_sessionmaker()() as s0:
        bump_version(s0, ws)
        s0.execute(
            text("UPDATE memberships SET role = 'member' WHERE workspace_id = :w AND user_id = :u"),
            {"w": ws, "u": uuid.UUID(admin["user"]["id"])},
        )
        bg = Background(
            lambda: client.patch(
                f"/api/v1/workspaces/{ws}", headers=admin["headers"], json={"name": "Hijack"}
            )
        )
        wait_for_lock_waiters(1)
        s0.commit()
    resp = bg.result()
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "forbidden"
    names = {
        m["workspace"]["name"]
        for m in client.get("/api/v1/me", headers=user["headers"]).json()["memberships"]
        if m["workspace"]["id"] == user["workspace_id"]
    }
    assert names == {old_name}


# ── accounts already without a workspace (whatif 715dc0eb scenario 6) ───────
def _strand_all(client, who) -> None:
    """Leave `who` with zero memberships, as released servers allowed."""
    me = client.get("/api/v1/me", headers=who["headers"]).json()
    for m in me["memberships"]:
        strand(uuid.UUID(m["workspace"]["id"]))


def test_me_rescues_an_account_without_a_workspace(client):
    nina = register_user(client, name="Nina")
    nina["headers"] = auth_headers(nina["access_token"])
    _strand_all(client, nina)
    me = client.get("/api/v1/me", headers=nina["headers"]).json()
    assert len(me["memberships"]) == 1
    assert me["memberships"][0]["role"] == "owner"
    assert me["memberships"][0]["workspace"]["name"] == "Nina"
    # Idempotent: the next call finds it.
    again = client.get("/api/v1/me", headers=nina["headers"]).json()
    assert again["memberships"] == me["memberships"]


def test_login_rescues_an_account_without_a_workspace(client):
    email = "stranded@example.com"
    nina = register_user(client, email=email, name="Nina")
    nina["headers"] = auth_headers(nina["access_token"])
    _strand_all(client, nina)
    resp = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "password123"}
    )
    assert resp.status_code == 200
    # Count in the database before /me, which would create the workspace itself.
    from sqlalchemy import text

    from balu.db import get_sessionmaker

    with get_sessionmaker()() as s:
        n = s.execute(
            text("SELECT count(*) FROM memberships m JOIN users u ON u.id = m.user_id "
                 "WHERE u.email = :e AND NOT m.is_deleted"),
            {"e": email},
        ).scalar_one()
    assert n == 1
    me = client.get("/api/v1/me", headers=auth_headers(resp.json()["access_token"])).json()
    assert [m["workspace"]["name"] for m in me["memberships"]] == ["Nina"]


def test_me_common_path_runs_no_count_query(client):
    from sqlalchemy import event

    from balu.db import get_engine

    nina = register_user(client, name="Nina")
    seen: list[str] = []

    def spy(conn, cursor, statement, *a):
        seen.append(statement.lower())

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", spy)
    try:
        resp = client.get("/api/v1/me", headers=auth_headers(nina["access_token"]))
    finally:
        event.remove(engine, "before_cursor_execute", spy)
    assert resp.status_code == 200
    assert not [q for q in seen if "memberships" in q and "count(" in q]
    assert len([q for q in seen if "from memberships" in q]) == 1


def test_parallel_me_on_a_workspaceless_account_makes_one_workspace(client):
    from balu.db import get_sessionmaker
    from balu.services import lock_users
    from tests.conftest import Background, wait_for_lock_waiters

    nina = register_user(client, name="Nina")
    nina["headers"] = auth_headers(nina["access_token"])
    _strand_all(client, nina)
    uid = uuid.UUID(nina["user"]["id"])
    with get_sessionmaker()() as s0:
        lock_users(s0, [uid])
        calls = [
            Background(lambda: client.get("/api/v1/me", headers=nina["headers"]))
            for _ in range(2)
        ]
        wait_for_lock_waiters(2)
        s0.commit()
    assert [c.result().status_code for c in calls] == [200, 200]
    me = client.get("/api/v1/me", headers=nina["headers"]).json()
    assert len(me["memberships"]) == 1
