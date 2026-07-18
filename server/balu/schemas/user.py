"""User schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    locale: str
    theme: str
    created_at: datetime


class MeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    locale: Literal["de", "en"] | None = None
    theme: Literal["system", "light", "dark"] | None = None
