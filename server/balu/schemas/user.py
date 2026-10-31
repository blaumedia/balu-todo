"""User schemas."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Annotated, Literal

from pydantic import BaseModel, StringConstraints

if TYPE_CHECKING:  # pragma: no cover
    from ..models import User


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    locale: str
    theme: str
    created_at: datetime


def user_out(user: User) -> UserOut:
    """The wire shape of a user row (D7: was duplicated in auth.py and me.py)."""
    return UserOut(
        id=str(user.id),
        email=user.email,
        name=user.name,
        locale=user.locale,
        theme=user.theme,
        created_at=user.created_at,
    )


class MeUpdate(BaseModel):
    name: Annotated[
        str | None, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
    ] = None
    locale: Literal["de", "en"] | None = None
    theme: Literal["system", "light", "dark"] | None = None
