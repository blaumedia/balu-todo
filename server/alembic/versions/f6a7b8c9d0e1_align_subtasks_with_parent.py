"""align live subtasks' project and section with their parent (data migration)

A subtask's project_id and section_id follow its parent. Before this release a
task_move of the parent left its subtasks behind. Idempotent: rows that already
match are untouched. Nesting deeper than one level (grandchildren, created by
older servers) is first flattened: such a row becomes a direct subtask of its
top-level ancestor. Sync tokens stay valid across an upgrade, so clients would
never pull the corrected rows unless their version moves: every affected workspace
gets one version bump (as ctx.bump() does) and its realigned subtasks carry it.

ROLLBACK: this revision's downgrade changes no data, but an image without this
file cannot boot on a database stamped with it ("Can't locate revision"). Before
switching back to an older image, run inside the NEW container:
    docker compose exec app python -m balu.migrate downgrade e5f6a7b8c9d0
(equivalent: `alembic downgrade e5f6a7b8c9d0` from the directory holding
alembic.ini, i.e. /app). Do not use BALU_AUTO_MIGRATE=0 instead: it leaves the
stamp in place, so a later upgrade would skip this migration.

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
    # `chain` maps every task reachable from a top-level task to that top-level
    # task (its root). Nesting deeper than one level can only come from older
    # servers that let a task with subtasks become a subtask; each such live
    # row is re-parented onto its root first, so the alignment below sees one
    # level only. Starting from the roots keeps the walk finite on any data.
    op.execute(
        """
        WITH RECURSIVE chain(id, root_id) AS (
            SELECT id, id FROM tasks WHERE parent_task_id IS NULL
            UNION ALL
            SELECT t.id, c.root_id
            FROM tasks AS t
            JOIN chain AS c ON t.parent_task_id = c.id
        ),
        target AS (
            SELECT s.id, s.workspace_id, r.id AS root_id,
                   r.project_id AS project_id, r.section_id AS section_id
            FROM tasks AS s
            JOIN chain AS c ON c.id = s.id
            JOIN tasks AS r ON r.id = c.root_id
            WHERE s.parent_task_id IS NOT NULL
              AND s.is_deleted = false
              AND (s.parent_task_id <> r.id
                   OR s.project_id IS DISTINCT FROM r.project_id
                   OR s.section_id IS DISTINCT FROM r.section_id)
        ),
        bumped AS (
            UPDATE workspaces AS w
            SET version = w.version + 1
            FROM (SELECT DISTINCT workspace_id FROM target) AS a
            WHERE w.id = a.workspace_id
            RETURNING w.id, w.version
        )
        UPDATE tasks AS s
        SET parent_task_id = t.root_id,
            project_id = t.project_id,
            section_id = t.section_id,
            version = b.version
        FROM target AS t, bumped AS b
        WHERE s.id = t.id
          AND b.id = t.workspace_id
        """
    )


def downgrade() -> None:
    # Data-only: the previous (diverged) values are not recoverable and not needed.
    pass
