"""Notification transports (§8).

Each transport is a plain function ``send(config, title, body)``; they are looked
up in ``TRANSPORTS`` so tests can inject fakes. ``transport_available`` gates
transports whose server-side env config is missing (email SMTP, telegram bot
token); ntfy carries its own topic URL in the channel config and is always
available.
"""

from __future__ import annotations

import logging
import smtplib
from collections.abc import Callable
from email.message import EmailMessage
from typing import Any

import httpx

from .config import get_settings
from .urlguard import UnsafeUrl, check_outbound_url

logger = logging.getLogger("balu.notifications")

_HTTP_TIMEOUT = 10.0


class ChannelUnavailable(Exception):
    """Raised when a channel's transport is not configured / delivery is impossible."""


# ---------------------------------------------------------------------------
# Transport availability
# ---------------------------------------------------------------------------
def transport_available(channel_type: str) -> bool:
    settings = get_settings()
    if channel_type == "ntfy":
        return True
    if channel_type == "email":
        return settings.smtp_configured
    if channel_type == "telegram":
        return settings.telegram_configured
    return False


# ---------------------------------------------------------------------------
# Transports
# ---------------------------------------------------------------------------
def send_ntfy(config: dict[str, Any], title: str, body: str) -> None:
    url = config.get("url")
    if not url:
        raise ChannelUnavailable("ntfy channel is missing a url")
    # Re-check at send time: DNS may have changed since the channel was stored.
    try:
        url = check_outbound_url(url)
    except UnsafeUrl as exc:
        # Deliberately vague: `exc` names the resolved address, and this message
        # reaches the client through POST /me/channels/test (S3/S6).
        logger.warning("blocked ntfy delivery to an unsafe url", exc_info=exc)
        raise ChannelUnavailable("ntfy url is not allowed") from exc
    resp = httpx.post(
        url,
        content=body.encode("utf-8"),
        headers={"Title": title, "Content-Type": "text/plain; charset=utf-8"},
        timeout=_HTTP_TIMEOUT,
        follow_redirects=False,  # a redirect would bypass the SSRF guard
    )
    # `raise_for_status` treats 3xx as success, so an un-followed redirect would
    # be reported as a working channel that silently delivers nothing.
    if resp.is_redirect:
        raise ChannelUnavailable("ntfy url redirects; configure the final URL")
    resp.raise_for_status()


def send_email(config: dict[str, Any], title: str, body: str) -> None:
    settings = get_settings()
    if not settings.smtp_configured:
        raise ChannelUnavailable("SMTP is not configured")
    address = config.get("address")
    if not address:
        raise ChannelUnavailable("email channel is missing an address")

    msg = EmailMessage()
    msg["Subject"] = title
    msg["From"] = settings.smtp_from
    msg["To"] = address
    msg.set_content(body)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=_HTTP_TIMEOUT) as smtp:
        if settings.smtp_port == 587:
            smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg)


def send_telegram(config: dict[str, Any], title: str, body: str) -> None:
    settings = get_settings()
    if not settings.telegram_configured:
        raise ChannelUnavailable("Telegram bot token is not configured")
    chat_id = config.get("chat_id")
    if not chat_id:
        raise ChannelUnavailable("telegram channel is missing a chat_id")
    text = f"{title}\n{body}" if body else title
    resp = httpx.post(
        f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
        json={"chat_id": chat_id, "text": text},
        timeout=_HTTP_TIMEOUT,
        follow_redirects=False,
    )
    if resp.is_redirect:
        raise ChannelUnavailable("telegram API redirected unexpectedly")
    resp.raise_for_status()


TRANSPORTS: dict[str, Callable[[dict[str, Any], str, str], None]] = {
    "ntfy": send_ntfy,
    "email": send_email,
    "telegram": send_telegram,
}


def send_to_channel(channel_type: str, config: dict[str, Any], title: str, body: str) -> None:
    """Deliver one message to one channel. Raises ChannelUnavailable/transport errors."""
    if not transport_available(channel_type):
        raise ChannelUnavailable(f"{channel_type} transport is not configured")
    transport = TRANSPORTS.get(channel_type)
    if transport is None:
        raise ChannelUnavailable(f"unknown channel type: {channel_type}")
    transport(config, title, body)
