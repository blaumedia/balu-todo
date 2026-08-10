"""Sync request/response schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Command(BaseModel):
    type: str = Field(max_length=64)
    uuid: str = Field(max_length=64)
    # Matches temp_id_map.temp_id's String(128) column.
    temp_id: str | None = Field(default=None, max_length=128)
    args: dict[str, Any] = Field(default_factory=dict)


class SyncRequest(BaseModel):
    sync_token: str = "*"
    commands: list[Command] = Field(default_factory=list, max_length=100)


class SyncResponse(BaseModel):
    sync_token: str
    full_sync: bool
    sync_status: dict[str, Any]
    temp_id_mapping: dict[str, str]
    projects: list[dict[str, Any]]
    sections: list[dict[str, Any]]
    tasks: list[dict[str, Any]]
    labels: list[dict[str, Any]]
    comments: list[dict[str, Any]]
    attachments: list[dict[str, Any]]
    members: list[dict[str, Any]]
