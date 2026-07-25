"""synced_commands: workspace-scoped idempotency key

The primary key was ``uuid`` alone, so a command uuid already recorded in one
workspace suppressed the same uuid in every other workspace and returned the
first workspace's stored status. Make it ``(workspace_id, uuid)``.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-25 10:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = 'c3d4e5f6a7b8'
down_revision: str | None = 'b2c3d4e5f6a7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint('synced_commands_pkey', 'synced_commands', type_='primary')
    op.create_primary_key(
        'synced_commands_pkey', 'synced_commands', ['workspace_id', 'uuid']
    )


def downgrade() -> None:
    # Collapsing back to a uuid-only key can collide across workspaces; keep the
    # first row per uuid so the constraint can be created at all.
    op.execute(
        """
        DELETE FROM synced_commands a
        USING synced_commands b
        WHERE a.uuid = b.uuid AND a.ctid > b.ctid
        """
    )
    op.drop_constraint('synced_commands_pkey', 'synced_commands', type_='primary')
    op.create_primary_key('synced_commands_pkey', 'synced_commands', ['uuid'])
