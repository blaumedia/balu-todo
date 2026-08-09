"""Per-user MCP bearer keys: generate, look up.

There is no lazy minting. Reading the settings screen is not consent to holding a
non-expiring full-access credential, and both settings UIs fetch on mount just to
decide whether to render the section - so a key exists only after the user asked
for one.
"""

from __future__ import annotations

import hmac
import secrets

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models import User

#: Recognisable at a glance in a config file or a leaked log line.
MCP_KEY_PREFIX = "balu_mcp_"
KEY_BYTES = 32


def new_mcp_key() -> str:
    return f"{MCP_KEY_PREFIX}{secrets.token_urlsafe(KEY_BYTES)}"


def generate_mcp_key(db: Session, user: User) -> str:
    """Store a fresh key for `user` and return exactly what was stored.

    Also the re-roll path: any previous key stops authenticating immediately. The
    write is a single ``UPDATE ... RETURNING`` rather than read-modify-write, so
    two concurrent generates serialise on the row instead of both reporting a key
    only one of them stored.
    """
    key = new_mcp_key()
    stored = db.execute(
        update(User).where(User.id == user.id).values(mcp_key=key).returning(User.mcp_key)
    ).scalar_one()
    db.commit()
    db.expire(user)  # the ORM copy still carries the pre-UPDATE value
    return str(stored)


def user_for_key(db: Session, presented: str) -> User | None:
    """Resolve a presented bearer key to its owner, or None.

    The lookup is an equality match on a unique index. The extra
    ``compare_digest`` costs nothing and keeps the comparison constant-time even
    if this ever grows a code path that filters candidates in Python.
    """
    if not presented.startswith(MCP_KEY_PREFIX):
        return None
    user = db.execute(select(User).where(User.mcp_key == presented)).scalar_one_or_none()
    if user is None or not user.mcp_key:
        return None
    if not hmac.compare_digest(user.mcp_key, presented):
        return None
    return user
