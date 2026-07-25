"""Sync bookkeeping tables: processed commands and temp_id mappings."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from .common import utcnow


class SyncedCommand(Base):
    """Idempotency log: one row per processed command uuid **per workspace**.

    The primary key is composite. With ``uuid`` alone, a command uuid recorded in
    one workspace suppressed the same uuid in every other workspace and replayed
    the first workspace's stored status (including its ``object_id``).
    """

    __tablename__ = "synced_commands"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    uuid: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    status_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class TempIdMap(Base):
    """Durable temp_id -> object_id resolution, persisted across requests."""

    __tablename__ = "temp_id_map"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    temp_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    object_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
