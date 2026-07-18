"""Notification-channel schemas (§8).

The wire shape is a flat, type-tagged object; validation of the type-specific
fields happens in the router (so we can raise the contract error envelope).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class ChannelIn(BaseModel):
    type: Literal["ntfy", "email", "telegram"]
    url: str | None = None
    address: str | None = None
    chat_id: str | None = None


class ChannelsIn(BaseModel):
    channels: list[ChannelIn]


class ChannelsResponse(BaseModel):
    channels: list[dict[str, Any]]


class ChannelTest(BaseModel):
    type: Literal["ntfy", "email", "telegram"]
