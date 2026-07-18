"""Comment commands: CRUD, temp_id chains, role/authorship rules, cascade, sync (§3.4, §5.4)."""

from __future__ import annotations

import uuid

from balu.models import Membership
from balu.sync.engine import bump_version
from tests.conftest import auth_headers, cmd, register_user, sync


def _only(items):
    assert len(items) == 1, items
    return items[0]


def _join(client, owner, role="member") -> dict:
    """Register a fresh user and accept an invite into owner's workspace with `role`."""
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


# ---------------------------------------------------------------------------
# Happy path + temp_id chain
# ---------------------------------------------------------------------------
def test_comment_add_same_batch_temp_id_chain(client, user):
    r = sync(
        client,
        user,
        "*",
        [
            cmd("task_add", temp_id="t1", title="Steuer"),
            cmd("comment_add", temp_id="c1", task_id="t1", body="Fast fertig."),
        ],
    )
    for status in r["sync_status"].values():
        assert status == "ok", r["sync_status"]
    tid = r["temp_id_mapping"]["t1"]
    cid = r["temp_id_mapping"]["c1"]
    comment = _only([c for c in r["comments"] if c["id"] == cid])
    assert comment["task_id"] == tid
    assert comment["author_id"] == user["user"]["id"]
    assert comment["body"] == "Fast fertig."
    assert comment["is_deleted"] is False


def test_comment_add_unknown_task_not_found(client, user):
    r = sync(
        client,
        user,
        "*",
        [cmd("comment_add", temp_id="c1", task_id=str(uuid.uuid4()), body="hi")],
    )
    status = list(r["sync_status"].values())[0]
    assert status["error_code"] == "not_found"


# ---------------------------------------------------------------------------
# Update: author only
# ---------------------------------------------------------------------------
def test_comment_update_by_author(client, user):
    r = sync(
        client,
        user,
        "*",
        [
            cmd("task_add", temp_id="t1", title="T"),
            cmd("comment_add", temp_id="c1", task_id="t1", body="v1"),
        ],
    )
    cid = r["temp_id_mapping"]["c1"]
    r2 = sync(client, user, r["sync_token"], [cmd("comment_update", id=cid, body="v2")])
    assert list(r2["sync_status"].values())[0] == "ok"
    assert _only([c for c in r2["comments"] if c["id"] == cid])["body"] == "v2"


def test_comment_update_by_other_member_forbidden(client, user):
    member = _join(client, user, role="member")
    r = sync(
        client,
        user,
        "*",
        [
            cmd("task_add", temp_id="t1", title="T"),
            cmd("comment_add", temp_id="c1", task_id="t1", body="owner comment"),
        ],
    )
    cid = r["temp_id_mapping"]["c1"]
    member_ctx = {"headers": member["headers"], "workspace_id": member["workspace_id"]}
    r2 = sync(client, member_ctx, "*", [cmd("comment_update", id=cid, body="hijack")])
    assert list(r2["sync_status"].values())[0]["error_code"] == "forbidden"


# ---------------------------------------------------------------------------
# Delete: author or admin+
# ---------------------------------------------------------------------------
def test_comment_delete_by_author(client, user):
    r = sync(
        client,
        user,
        "*",
        [
            cmd("task_add", temp_id="t1", title="T"),
            cmd("comment_add", temp_id="c1", task_id="t1", body="mine"),
        ],
    )
    cid = r["temp_id_mapping"]["c1"]
    r2 = sync(client, user, r["sync_token"], [cmd("comment_delete", id=cid)])
    assert list(r2["sync_status"].values())[0] == "ok"
    assert _only([c for c in r2["comments"] if c["id"] == cid])["is_deleted"] is True


def test_comment_delete_by_admin(client, user):
    """Owner (>= admin) may delete a member's comment."""
    member = _join(client, user, role="member")
    member_ctx = {"headers": member["headers"], "workspace_id": member["workspace_id"]}
    # Owner creates the task; member comments on it.
    r = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="T")])
    tid = r["temp_id_mapping"]["t1"]
    rc = sync(client, member_ctx, "*", [cmd("comment_add", temp_id="c1", task_id=tid, body="hi")])
    cid = rc["temp_id_mapping"]["c1"]
    # Owner deletes the member's comment -> ok.
    r2 = sync(client, user, "*", [cmd("comment_delete", id=cid)])
    assert list(r2["sync_status"].values())[0] == "ok"


def test_comment_delete_by_non_author_non_admin_forbidden(client, user):
    author = _join(client, user, role="member")
    other = _join(client, user, role="member")
    author_ctx = {"headers": author["headers"], "workspace_id": author["workspace_id"]}
    other_ctx = {"headers": other["headers"], "workspace_id": other["workspace_id"]}
    r = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="T")])
    tid = r["temp_id_mapping"]["t1"]
    rc = sync(client, author_ctx, "*", [cmd("comment_add", temp_id="c1", task_id=tid, body="hi")])
    cid = rc["temp_id_mapping"]["c1"]
    r2 = sync(client, other_ctx, "*", [cmd("comment_delete", id=cid)])
    assert list(r2["sync_status"].values())[0]["error_code"] == "forbidden"


# ---------------------------------------------------------------------------
# Viewer role: every comment command forbidden
# ---------------------------------------------------------------------------
def test_viewer_cannot_comment(client, user, db):
    viewer = register_user(client, email="viewer-c@example.com", name="Vera")
    viewer_id = uuid.UUID(viewer["user"]["id"])
    ws_id = uuid.UUID(user["workspace_id"])
    version = bump_version(db, ws_id)
    db.add(Membership(workspace_id=ws_id, user_id=viewer_id, role="viewer", version=version))
    db.commit()
    viewer_ctx = {
        "headers": auth_headers(viewer["access_token"]),
        "workspace_id": user["workspace_id"],
    }

    r = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="T")])
    tid = r["temp_id_mapping"]["t1"]
    rv = sync(client, viewer_ctx, "*", [cmd("comment_add", temp_id="c1", task_id=tid, body="x")])
    assert list(rv["sync_status"].values())[0]["error_code"] == "forbidden"


# ---------------------------------------------------------------------------
# Body length validation
# ---------------------------------------------------------------------------
def test_comment_body_validation(client, user):
    r = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="T")])
    tid = r["temp_id_mapping"]["t1"]

    empty = sync(client, user, "*", [cmd("comment_add", temp_id="c1", task_id=tid, body="")])
    assert list(empty["sync_status"].values())[0]["error_code"] == "invalid_args"

    too_long = sync(
        client, user, "*", [cmd("comment_add", temp_id="c2", task_id=tid, body="x" * 5001)]
    )
    assert list(too_long["sync_status"].values())[0]["error_code"] == "invalid_args"

    ok = sync(
        client, user, "*", [cmd("comment_add", temp_id="c3", task_id=tid, body="x" * 5000)]
    )
    assert list(ok["sync_status"].values())[0] == "ok"


# ---------------------------------------------------------------------------
# Cascade + incremental sync
# ---------------------------------------------------------------------------
def test_task_delete_cascades_comments(client, user):
    r = sync(
        client,
        user,
        "*",
        [
            cmd("task_add", temp_id="t1", title="T"),
            cmd("comment_add", temp_id="c1", task_id="t1", body="doomed"),
        ],
    )
    tid = r["temp_id_mapping"]["t1"]
    cid = r["temp_id_mapping"]["c1"]
    r2 = sync(client, user, r["sync_token"], [cmd("task_delete", id=tid)])
    comment = _only([c for c in r2["comments"] if c["id"] == cid])
    assert comment["is_deleted"] is True


def test_comment_in_incremental_sync(client, user):
    base = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="T")])
    tid = base["temp_id_mapping"]["t1"]
    token = base["sync_token"]
    added = sync(client, user, token, [cmd("comment_add", temp_id="c1", task_id=tid, body="delta")])
    cid = added["temp_id_mapping"]["c1"]
    # The incremental delta from `token` includes the new comment.
    assert any(c["id"] == cid for c in added["comments"])
    # A fresh incremental pull from the newest token no longer includes it.
    quiet = sync(client, user, added["sync_token"])
    assert all(c["id"] != cid for c in quiet["comments"])


def test_comment_in_full_sync(client, user):
    sync(
        client,
        user,
        "*",
        [
            cmd("task_add", temp_id="t1", title="T"),
            cmd("comment_add", temp_id="c1", task_id="t1", body="hello"),
        ],
    )
    full = sync(client, user, "*")
    assert any(c["body"] == "hello" for c in full["comments"])
