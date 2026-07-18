"""invites, user_channels, tasks.reminder_sent_at

Revision ID: a1b2c3d4e5f6
Revises: cf06b02cb890
Create Date: 2026-07-23 12:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = 'a1b2c3d4e5f6'
down_revision: str | None = 'cf06b02cb890'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('invites',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=True),
    sa.Column('token_hash', sa.String(length=128), nullable=False),
    sa.Column('revoked', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_invites_token_hash'), 'invites', ['token_hash'], unique=True)
    op.create_index(op.f('ix_invites_workspace_id'), 'invites', ['workspace_id'], unique=False)

    op.create_table('user_channels',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('type', sa.String(length=16), nullable=False),
    sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_channels_user_id'), 'user_channels', ['user_id'], unique=False)

    op.add_column('tasks', sa.Column('reminder_sent_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('tasks', 'reminder_sent_at')
    op.drop_index(op.f('ix_user_channels_user_id'), table_name='user_channels')
    op.drop_table('user_channels')
    op.drop_index(op.f('ix_invites_workspace_id'), table_name='invites')
    op.drop_index(op.f('ix_invites_token_hash'), table_name='invites')
    op.drop_table('invites')
