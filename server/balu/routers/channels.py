"""Notification-channel endpoints (§8): list / replace / test.

Channels are per-user. PUT replaces the whole list and validates each entry's
shape and that its transport is configured server-side (else channel_unavailable).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Response, status
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..errors import channel_unavailable, validation_error
from ..models import User, UserChannel
from ..notifications import ChannelUnavailable, send_to_channel, transport_available
from ..schemas.channel import ChannelIn, ChannelsIn, ChannelsResponse, ChannelTest
from ..urlguard import UnsafeUrl, check_outbound_url

logger = logging.getLogger("balu.channels")

router = APIRouter(prefix="/me/channels", tags=["channels"])

_TEST_TITLE = "Balu test notification"
_TEST_BODY = "If you can read this, your Balu notification channel works."


def _channel_config(channel: ChannelIn, user: User) -> dict:
    """Validate the type-specific field and return the stored config dict."""
    if channel.type == "ntfy":
        # SSRF guard: only public http(s) endpoints (§8). Re-checked at send time.
        try:
            url = check_outbound_url(channel.url or "")
        except UnsafeUrl as exc:
            # The guard's message names the resolved IP — echoing it back would
            # hand any authenticated user a DNS→address oracle for the internal
            # network, which is most of what the SSRF fix was for (S3/S6).
            logger.warning("rejected ntfy url for user=%s", user.id, exc_info=exc)
            raise validation_error(
                "ntfy channel requires a valid public http(s) url"
            ) from exc
        return {"url": url}
    if channel.type == "email":
        if not channel.address:
            raise validation_error("email channel requires an address")
        try:
            address = TypeAdapter(EmailStr).validate_python(channel.address.strip())
        except ValidationError as exc:
            raise validation_error("email channel requires a valid address") from exc
        # No confirmation flow in v1: a user may only send mail to themselves,
        # otherwise the deployment's SMTP identity becomes an open relay.
        if address.lower() != user.email.lower():
            raise validation_error(
                "email channel address must be your own account address"
            )
        return {"address": address}
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
        config = _channel_config(channel, user)
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
            # Never surface the transport's exception text: it can carry internal
            # hostnames and doubles as an SSRF oracle (S3/S6).
            logger.warning(
                "channel test delivery failed for user=%s type=%s", user.id, body.type,
                exc_info=exc,
            )
            raise channel_unavailable(f"{body.type} delivery failed") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
