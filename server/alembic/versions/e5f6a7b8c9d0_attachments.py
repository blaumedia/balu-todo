"""attachments (v1.4)

Metadata only. The bytes live on the filesystem under BALU_DATA_DIR, so a
downgrade drops the rows but deliberately leaves the blobs alone - Alembic has
no business deleting user data it cannot roll back.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-08-10 09:10:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'e5f6a7b8c9d0'
down_revision: str | None = 'd4e5f6a7b8c9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('attachments',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('task_id', sa.Uuid(), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('content_type', sa.String(length=128), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('version', sa.BigInteger(), nullable=False),
    sa.Column('is_deleted', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_attachments_task_id'), 'attachments', ['task_id'], unique=False)
    op.create_index(op.f('ix_attachments_version'), 'attachments', ['version'], unique=False)
    op.create_index(op.f('ix_attachments_workspace_id'), 'attachments', ['workspace_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_attachments_workspace_id'), table_name='attachments')
    op.drop_index(op.f('ix_attachments_version'), table_name='attachments')
    op.drop_index(op.f('ix_attachments_task_id'), table_name='attachments')
    op.drop_table('attachments')
