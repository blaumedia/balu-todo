"""Notification channels CRUD + test endpoint (§8)."""

from __future__ import annotations

import pytest

import balu.routers.channels as channels_router


def test_get_channels_empty(client, user):
    resp = client.get("/api/v1/me/channels", headers=user["headers"])
    assert resp.status_code == 200
    assert resp.json()["channels"] == []


def test_put_ntfy_channel(client, user):
    resp = client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "ntfy", "url": "https://93.184.216.34/my-topic"}]},
    )
    assert resp.status_code == 200
    channels = resp.json()["channels"]
    assert channels == [{"type": "ntfy", "url": "https://93.184.216.34/my-topic"}]
    # Persisted.
    got = client.get("/api/v1/me/channels", headers=user["headers"]).json()
    assert got["channels"] == channels


def test_put_replaces_full_list(client, user):
    client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "ntfy", "url": "https://93.184.216.34/a"}]},
    )
    resp = client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "ntfy", "url": "https://93.184.216.34/b"}]},
    )
    assert resp.status_code == 200
    urls = [c["url"] for c in resp.json()["channels"]]
    assert urls == ["https://93.184.216.34/b"]


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
        json={"channels": [{"type": "email", "address": user["user"]["email"]}]},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "channel_unavailable"


# ── S4: email destination is bound to the authenticated user ───────────────
def test_put_email_foreign_address_rejected(client, user):
    resp = client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "email", "address": "victim@example.com"}]},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "validation_error"


def test_put_email_malformed_address_rejected(client, user):
    resp = client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "email", "address": "not-an-email"}]},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "validation_error"


def test_put_email_own_address_accepted(client, user, monkeypatch):
    import balu.notifications as notifications

    monkeypatch.setattr(notifications, "transport_available", lambda t: True)
    monkeypatch.setattr(channels_router, "transport_available", lambda t: True)
    resp = client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "email", "address": user["user"]["email"].upper()}]},
    )
    assert resp.status_code == 200
    assert resp.json()["channels"][0]["address"].lower() == user["user"]["email"].lower()


# ── S3: SSRF guard on the ntfy channel URL ─────────────────────────────────
SSRF_URLS = [
    "http://127.0.0.1:8000/topic",
    "http://localhost/topic",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/topic",
    "http://192.168.1.1/topic",
    "http://172.16.0.1/topic",
    "http://[::1]/topic",
    "http://0.0.0.0/topic",
    "file:///etc/passwd",
    "gopher://127.0.0.1/",
]


@pytest.mark.parametrize("url", SSRF_URLS)
def test_put_ntfy_rejects_internal_targets(client, user, url):
    resp = client.put(
        "/api/v1/me/channels",
        headers=user["headers"],
        json={"channels": [{"type": "ntfy", "url": url}]},
    )
    assert resp.status_code == 422, url
    assert resp.json()["detail"]["code"] == "validation_error"
    # And nothing was stored.
    got = client.get("/api/v1/me/channels", headers=user["headers"]).json()
    assert got["channels"] == []


def test_send_ntfy_rechecks_url_at_delivery_time(client, user):
    """A config that slipped past storage time is still refused when sending."""
    from balu.notifications import ChannelUnavailable, send_ntfy

    with pytest.raises(ChannelUnavailable):
        send_ntfy({"url": "http://169.254.169.254/latest/meta-data/"}, "t", "b")


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
        json={"channels": [{"type": "ntfy", "url": "https://93.184.216.34/topic"}]},
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
        json={"channels": [{"type": "ntfy", "url": "https://93.184.216.34/topic"}]},
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
