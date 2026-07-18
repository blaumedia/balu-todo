"""comments (v1.2)

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-23 14:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'b2c3d4e5f6a7'
down_revision: str | None = 'a1b2c3d4e5f6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('comments',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('task_id', sa.Uuid(), nullable=False),
    sa.Column('author_id', sa.Uuid(), nullable=True),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('version', sa.BigInteger(), nullable=False),
    sa.Column('is_deleted', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_comments_task_id'), 'comments', ['task_id'], unique=False)
    op.create_index(op.f('ix_comments_version'), 'comments', ['version'], unique=False)
    op.create_index(op.f('ix_comments_workspace_id'), 'comments', ['workspace_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_comments_workspace_id'), table_name='comments')
    op.drop_index(op.f('ix_comments_version'), table_name='comments')
    op.drop_index(op.f('ix_comments_task_id'), table_name='comments')
    op.drop_table('comments')
