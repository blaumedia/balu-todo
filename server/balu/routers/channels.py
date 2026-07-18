"""Notification-channel endpoints (§8): list / replace / test.

Channels are per-user. PUT replaces the whole list and validates each entry's
shape and that its transport is configured server-side (else channel_unavailable).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..errors import channel_unavailable, validation_error
from ..models import User, UserChannel
from ..notifications import ChannelUnavailable, send_to_channel, transport_available
from ..schemas.channel import ChannelIn, ChannelsIn, ChannelsResponse, ChannelTest

router = APIRouter(prefix="/me/channels", tags=["channels"])

_TEST_TITLE = "Balu test notification"
_TEST_BODY = "If you can read this, your Balu notification channel works."


def _channel_config(channel: ChannelIn) -> dict:
    """Validate the type-specific field and return the stored config dict."""
    if channel.type == "ntfy":
        if not channel.url or not channel.url.startswith(("http://", "https://")):
            raise validation_error("ntfy channel requires a valid url")
        return {"url": channel.url}
    if channel.type == "email":
        if not channel.address:
            raise validation_error("email channel requires an address")
        return {"address": channel.address}
    if channel.type == "telegram":
        if not channel.chat_id:
            raise validation_error("telegram channel requires a chat_id")
        return {"chat_id": channel.chat_id}
    raise validation_error(f"unknown channel type: {channel.type}")


def _serialize(channel: UserChannel) -> dict:
    return {"type": channel.type, **channel.config}


@router.get("", response_model=ChannelsResponse)
def get_channels(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelsResponse:
    rows = (
        db.execute(select(UserChannel).where(UserChannel.user_id == user.id))
        .scalars()
        .all()
    )
    return ChannelsResponse(channels=[_serialize(c) for c in rows])


@router.put("", response_model=ChannelsResponse)
def put_channels(
    body: ChannelsIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChannelsResponse:
    # Validate every channel before mutating anything.
    prepared: list[tuple[str, dict]] = []
    for channel in body.channels:
        config = _channel_config(channel)
        if not transport_available(channel.type):
            raise channel_unavailable(f"{channel.type} transport is not configured")
        prepared.append((channel.type, config))

    db.execute(
        UserChannel.__table__.delete().where(UserChannel.user_id == user.id)
    )
    for ctype, config in prepared:
        db.add(UserChannel(user_id=user.id, type=ctype, config=config))
    db.commit()

    rows = (
        db.execute(select(UserChannel).where(UserChannel.user_id == user.id))
        .scalars()
        .all()
    )
    return ChannelsResponse(channels=[_serialize(c) for c in rows])


@router.post("/test", status_code=status.HTTP_204_NO_CONTENT)
def test_channel(
    body: ChannelTest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    channels = (
        db.execute(
            select(UserChannel).where(
                UserChannel.user_id == user.id, UserChannel.type == body.type
            )
        )
        .scalars()
        .all()
    )
    if not channels:
        raise channel_unavailable(f"no {body.type} channel configured")
    for channel in channels:
        try:
            send_to_channel(channel.type, channel.config, _TEST_TITLE, _TEST_BODY)
        except ChannelUnavailable as exc:
            raise channel_unavailable(str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 - delivery failure -> channel_unavailable
            raise channel_unavailable(f"{body.type} delivery failed: {exc}") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
