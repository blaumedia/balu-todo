"""Invite & member-management schemas (§7)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr


class InviteCreate(BaseModel):
    role: Literal["admin", "member", "viewer"]
    email: EmailStr | None = None


class InviteOut(BaseModel):
    id: str
    workspace_id: str
    role: str
    email: str | None
    # Plaintext token is only present in the create response (stored hashed).
    token: str | None = None
    created_at: datetime
    expires_at: datetime


class InvitesResponse(BaseModel):
    invites: list[InviteOut]


class InviteAccept(BaseModel):
    token: str


class MemberRoleUpdate(BaseModel):
    role: Literal["owner", "admin", "member", "viewer"]
