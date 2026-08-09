"""users.mcp_key - per-user remote MCP bearer key (v1.3)

Nullable with no backfill: a key exists only after the user asks for one via
POST /me/mcp/key, so existing rows migrate without a rewrite and nobody ends up
holding a credential they never requested.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-08-09 10:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'd4e5f6a7b8c9'
down_revision: str | None = 'c3d4e5f6a7b8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('mcp_key', sa.String(length=64), nullable=True))
    # Unique so a key names exactly one user, indexed because every MCP request
    # authenticates by looking the presented key up here.
    op.create_index(op.f('ix_users_mcp_key'), 'users', ['mcp_key'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_users_mcp_key'), table_name='users')
    op.drop_column('users', 'mcp_key')
