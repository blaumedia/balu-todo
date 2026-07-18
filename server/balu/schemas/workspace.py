"""Workspace & membership schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .user import UserOut


class WorkspaceOut(BaseModel):
    id: str
    name: str
    created_at: datetime


class AcceptInviteResponse(BaseModel):
    workspace: WorkspaceOut


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class WorkspaceUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class MembershipOut(BaseModel):
    workspace: WorkspaceOut
    role: str


class MeResponse(BaseModel):
    user: UserOut
    memberships: list[MembershipOut]
