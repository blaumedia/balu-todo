"""Event notifications (§8, v1.2): assignment + comment, injected fake sender."""

from __future__ import annotations

import pytest

from balu.events import get_event_sender
from balu.main import app
from tests.conftest import auth_headers, cmd, register_user, sync


class Recorder:
    def __init__(self):
        self.calls = []

    def __call__(self, ctype, config, title, body):
        self.calls.append((ctype, config, title, body))

    @property
    def urls(self):
        return {c[1].get("url") for c in self.calls}


@pytest.fixture
def rec():
    """Install a fake event sender via dependency override; auto-remove after."""
    recorder = Recorder()
    api = app.state.api  # the /api/v1 sub-app owns the sync route + its dependencies
    api.dependency_overrides[get_event_sender] = lambda: recorder
    try:
        yield recorder
    finally:
        api.dependency_overrides.pop(get_event_sender, None)


def _join(client, owner, role="member") -> dict:
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


def _config_channel(client, ctx, url):
    resp = client.put(
        "/api/v1/me/channels",
        headers=ctx["headers"],
        json={"channels": [{"type": "ntfy", "url": url}]},
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Assignment
# ---------------------------------------------------------------------------
def test_assignment_by_other_notifies_assignee(client, user, rec):
    member = _join(client, user, role="member")
    _config_channel(client, member, "https://93.184.216.34/member")

    sync(
        client,
        user,
        "*",
        [cmd("task_add", temp_id="t1", title="Wichtig", assigned_to=member["user"]["id"])],
    )

    assert len(rec.calls) == 1
    ctype, config, title, _body = rec.calls[0]
    assert ctype == "ntfy"
    assert config["url"] == "https://93.184.216.34/member"
    assert user["user"]["name"] in title  # actor name
    assert "Wichtig" in title  # task title


def test_self_assignment_not_notified(client, user, rec):
    _config_channel(client, user, "https://93.184.216.34/self")
    sync(
        client,
        user,
        "*",
        [cmd("task_add", temp_id="t1", title="Solo", assigned_to=user["user"]["id"])],
    )
    assert rec.calls == []


def test_assignee_without_channel_skipped_silently(client, user, rec):
    member = _join(client, user, role="member")  # no channel configured
    r = sync(
        client,
        user,
        "*",
        [cmd("task_add", temp_id="t1", title="Quiet", assigned_to=member["user"]["id"])],
    )
    assert list(r["sync_status"].values())[0] == "ok"
    assert rec.calls == []


def test_assignment_via_update_notifies(client, user, rec):
    member = _join(client, user, role="member")
    _config_channel(client, member, "https://93.184.216.34/member")
    r = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="Later")])
    tid = r["temp_id_mapping"]["t1"]
    rec.calls.clear()

    sync(
        client,
        user,
        r["sync_token"],
        [cmd("task_update", id=tid, assigned_to=member["user"]["id"])],
    )
    assert len(rec.calls) == 1
    assert rec.calls[0][1]["url"] == "https://93.184.216.34/member"


def test_assignment_notification_never_fails_command(client, user, rec):
    """A raising sender must not affect sync_status."""
    member = _join(client, user, role="member")
    _config_channel(client, member, "https://93.184.216.34/member")

    def boom(ctype, config, title, body):
        raise RuntimeError("transport down")

    app.state.api.dependency_overrides[get_event_sender] = lambda: boom
    r = sync(
        client,
        user,
        "*",
        [cmd("task_add", temp_id="t1", title="Robust", assigned_to=member["user"]["id"])],
    )
    assert list(r["sync_status"].values())[0] == "ok"


# ---------------------------------------------------------------------------
# Comment
# ---------------------------------------------------------------------------
def test_comment_notifies_participants_minus_actor(client, user, rec):
    # owner = creator, member = assignee, third = prior comment author.
    member = _join(client, user, role="member")
    third = _join(client, user, role="member")
    _config_channel(client, user, "https://93.184.216.34/owner")
    _config_channel(client, member, "https://93.184.216.34/member")
    _config_channel(client, third, "https://93.184.216.34/third")
    third_ctx = {"headers": third["headers"], "workspace_id": third["workspace_id"]}

    r = sync(
        client,
        user,
        "*",
        [cmd("task_add", temp_id="t1", title="Thread", assigned_to=member["user"]["id"])],
    )
    tid = r["temp_id_mapping"]["t1"]
    # third posts the first (prior) comment.
    sync(client, third_ctx, "*", [cmd("comment_add", temp_id="c1", task_id=tid, body="erste")])

    rec.calls.clear()
    # owner (creator, the actor) comments -> notifies assignee(member) + prior author(third),
    # NOT the actor(owner).
    sync(client, user, "*", [cmd("comment_add", temp_id="c2", task_id=tid, body="antwort")])

    assert rec.urls == {"https://93.184.216.34/member", "https://93.184.216.34/third"}
    assert "https://93.184.216.34/owner" not in rec.urls
    # Body carries the comment text; title carries actor + task title.
    for _ctype, _config, title, body in rec.calls:
        assert body == "antwort"
        assert user["user"]["name"] in title
        assert "Thread" in title


def test_comment_author_alone_notifies_nobody(client, user, rec):
    _config_channel(client, user, "https://93.184.216.34/owner")
    r = sync(client, user, "*", [cmd("task_add", temp_id="t1", title="Alone")])
    tid = r["temp_id_mapping"]["t1"]
    rec.calls.clear()
    # Creator == assignee(none) == only participant == actor -> no one to notify.
    sync(client, user, "*", [cmd("comment_add", temp_id="c1", task_id=tid, body="hi")])
    assert rec.calls == []
