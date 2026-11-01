"""align live subtasks' project and section with their parent (data migration)

A subtask's project_id and section_id follow its parent. Before this release a
task_move of the parent left its subtasks behind. Idempotent: rows that already
match are untouched. Versions are not bumped here; clients are full-synced on a
server upgrade anyway and the views read subtasks through their parent.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-09-20 10:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = 'f6a7b8c9d0e1'
down_revision: str | None = 'e5f6a7b8c9d0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE tasks AS s
        SET project_id = p.project_id, section_id = p.section_id
        FROM tasks AS p
        WHERE s.parent_task_id = p.id
          AND s.is_deleted = false
          AND (s.project_id IS DISTINCT FROM p.project_id
               OR s.section_id IS DISTINCT FROM p.section_id)
        """
    )


def downgrade() -> None:
    # Data-only: the previous (diverged) values are not recoverable and not needed.
    pass
