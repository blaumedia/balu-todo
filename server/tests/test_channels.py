"""Notification channels CRUD + test endpoint (§8)."""

from __future__ import annotations

import balu.routers.channels as channels_router


def test_get_channels_empty(client, user):
    resp = client.get("/api/v1/me/channels", headers=user["headers"])
    assert resp.status_code == 200
    assert resp.json()["channels"] == []


def test_put_ntfy_channel(client, user):
    resp = client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "ntfy", "url": "https://ntfy.sh/my-topic"}]},
    )
    assert resp.status_code == 200
    channels = resp.json()["channels"]
    assert channels == [{"type": "ntfy", "url": "https://ntfy.sh/my-topic"}]
    # Persisted.
    got = client.get("/api/v1/me/channels", headers=user["headers"]).json()
    assert got["channels"] == channels


def test_put_replaces_full_list(client, user):
    client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "ntfy", "url": "https://ntfy.sh/a"}]},
    )
    resp = client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "ntfy", "url": "https://ntfy.sh/b"}]},
    )
    assert resp.status_code == 200
    urls = [c["url"] for c in resp.json()["channels"]]
    assert urls == ["https://ntfy.sh/b"]


def test_put_ntfy_missing_url_is_validation_error(client, user):
    resp = client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "ntfy"}]},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "validation_error"


def test_put_email_without_smtp_unavailable(client, user):
    resp = client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "email", "address": "me@example.com"}]},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "channel_unavailable"


def test_put_telegram_without_token_unavailable(client, user):
    resp = client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "telegram", "chat_id": "12345"}]},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "channel_unavailable"


def test_test_channel_success(client, user, monkeypatch):
    sent = []
    monkeypatch.setattr(
        channels_router,
        "send_to_channel",
        lambda ctype, config, title, body: sent.append((ctype, config, title, body)),
    )
    client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "ntfy", "url": "https://ntfy.sh/topic"}]},
    )
    resp = client.post(
        "/api/v1/me/channels/test", headers=user["headers"], json={"type": "ntfy"}
    )
    assert resp.status_code == 204
    assert len(sent) == 1
    assert sent[0][0] == "ntfy"


def test_test_channel_delivery_failure(client, user, monkeypatch):
    def _boom(ctype, config, title, body):
        raise RuntimeError("network down")

    monkeypatch.setattr(channels_router, "send_to_channel", _boom)
    client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "ntfy", "url": "https://ntfy.sh/topic"}]},
    )
    resp = client.post(
        "/api/v1/me/channels/test", headers=user["headers"], json={"type": "ntfy"}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "channel_unavailable"


def test_test_channel_none_configured(client, user):
    resp = client.post(
        "/api/v1/me/channels/test", headers=user["headers"], json={"type": "ntfy"}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "channel_unavailable"
