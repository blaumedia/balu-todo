"""Reminder tick: delivery, once-only, re-arming, skipping (§8)."""

from __future__ import annotations

from balu.db import get_sessionmaker
from balu.reminders import reminder_tick
from tests.conftest import cmd, sync

PAST = "2020-01-01T09:00:00Z"
FUTURE = "2999-01-01T09:00:00Z"


class Recorder:
    def __init__(self):
        self.calls = []

    def __call__(self, ctype, config, title, body):
        self.calls.append((ctype, config, title, body))


def _configure_ntfy(client, user):
    resp = client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "ntfy", "url": "https://93.184.216.34/topic"}]},
    )
    assert resp.status_code == 200


def _run_tick(sender):
    sm = get_sessionmaker()
    with sm() as session:
        return reminder_tick(session, sender=sender)


def test_reminder_sent_once(client, user):
    _configure_ntfy(client, user)
    sync(client, user, "*", [cmd("task_add", temp_id="t1", title="Call bank", reminder_at=PAST)])

    rec = Recorder()
    assert _run_tick(rec) == 1
    assert len(rec.calls) == 1
    assert rec.calls[0][0] == "ntfy"
    assert rec.calls[0][2] == "Call bank"

    # Second tick: already delivered -> nothing.
    rec2 = Recorder()
    assert _run_tick(rec2) == 0
    assert rec2.calls == []


def test_reminder_rearms_on_change(client, user):
    _configure_ntfy(client, user)
    added = sync(
        client, user, "*", [cmd("task_add", temp_id="t1", title="Ping", reminder_at=PAST)]
    )
    task_id = added["temp_id_mapping"]["t1"]

    rec = Recorder()
    assert _run_tick(rec) == 1

    # Change reminder_at -> reminder_sent_at cleared -> fires again.
    sync(client, user, added["sync_token"], [cmd("task_update", id=task_id, reminder_at=PAST)])
    rec2 = Recorder()
    assert _run_tick(rec2) == 1
    assert len(rec2.calls) == 1


def test_reminder_skips_completed(client, user):
    _configure_ntfy(client, user)
    added = sync(
        client, user, "*", [cmd("task_add", temp_id="t1", title="Done", reminder_at=PAST)]
    )
    task_id = added["temp_id_mapping"]["t1"]
    sync(client, user, added["sync_token"], [cmd("task_complete", id=task_id)])

    rec = Recorder()
    assert _run_tick(rec) == 0
    assert rec.calls == []


def test_reminder_skips_deleted(client, user):
    _configure_ntfy(client, user)
    added = sync(
        client, user, "*", [cmd("task_add", temp_id="t1", title="Gone", reminder_at=PAST)]
    )
    task_id = added["temp_id_mapping"]["t1"]
    sync(client, user, added["sync_token"], [cmd("task_delete", id=task_id)])

    rec = Recorder()
    assert _run_tick(rec) == 0


def test_reminder_skips_future(client, user):
    _configure_ntfy(client, user)
    sync(client, user, "*", [cmd("task_add", temp_id="t1", title="Later", reminder_at=FUTURE)])

    rec = Recorder()
    assert _run_tick(rec) == 0


def test_reminder_message_includes_deadline(client, user):
    _configure_ntfy(client, user)
    sync(
        client,
        user,
        "*",
        [
            cmd(
                "task_add",
                temp_id="t1",
                title="File taxes",
                reminder_at=PAST,
                deadline="2026-07-31",
            )
        ],
    )
    rec = Recorder()
    assert _run_tick(rec) == 1
    body = rec.calls[0][3]
    assert "2026-07-31" in body


def test_reminder_no_channels_still_marks_sent(client, user):
    # No channels configured: nothing delivered, but the reminder is still consumed.
    sync(client, user, "*", [cmd("task_add", temp_id="t1", title="Quiet", reminder_at=PAST)])
    rec = Recorder()
    assert _run_tick(rec) == 1
    assert rec.calls == []
    # Consumed: a second tick does nothing.
    assert _run_tick(Recorder()) == 0


def test_reminder_sent_at_not_in_sync_payload(client, user):
    _configure_ntfy(client, user)
    sync(client, user, "*", [cmd("task_add", temp_id="t1", title="X", reminder_at=PAST)])
    _run_tick(Recorder())
    full = sync(client, user, "*")
    assert full["tasks"]
    for task in full["tasks"]:
        assert "reminder_sent_at" not in task
