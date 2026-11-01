"""align live subtasks' project and section with their parent (data migration)

A subtask's project_id and section_id follow its parent. Before this release a
task_move of the parent left its subtasks behind. Idempotent: rows that already
match are untouched. Nesting deeper than one level (grandchildren, created by
older servers) is first flattened: such a live row becomes a direct subtask of
its top-level ancestor and is appended after that ancestor's subtasks (sort_order
= the ancestor's highest live subtask sort_order + 1000 * n, the contract's
"max + 1000" rule), in depth-first order of the old sort_orders so that the rows
of one former parent stay together. Only live rows are walked: a live row under
a deleted ancestor was hidden before and stays untouched, it is not
resurrected. Rows in a parent cycle are unreachable from a top-level task and
stay unchanged. Sync tokens stay valid across an upgrade, so clients would never
pull the corrected rows unless their version moves: every affected workspace
gets one version bump (as ctx.bump() does) and its realigned subtasks carry it.

ROLLBACK: this revision's downgrade changes no data, but an image without this
file cannot boot on a database stamped with it ("Can't locate revision"). Steps:
1. With the NEW container still running, run
       docker compose exec app python -m balu.migrate downgrade e5f6a7b8c9d0
   (equivalent: `alembic downgrade e5f6a7b8c9d0` from /app, the directory holding
   alembic.ini).
2. Pin the older image tag in docker-compose.yml, then `docker compose pull` and
   `docker compose up -d`.
Do not restart the new container between 1 and 2: with `restart: unless-stopped`
it would migrate straight back to head. Do not use BALU_AUTO_MIGRATE=0 instead:
it leaves the stamp in place, so a later upgrade would skip this migration.

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
    # `chain` maps every live task reachable from a live top-level task through
    # live rows only to that top-level task (its root). Nesting deeper than one
    # level can only come from older servers that let a task with subtasks
    # become a subtask; each such live row is re-parented onto its root first,
    # so the alignment below sees one level only. A deleted row ends the walk:
    # live rows below it were hidden before and stay as they are. Starting from
    # the roots keeps the walk finite on any data (a parent cycle has no root).
    # `path` carries the sort_order values from the root down, so ordering by it
    # is depth-first and keeps each former parent's rows together.
    op.execute(
        """
        WITH RECURSIVE chain(id, root_id, path) AS (
            SELECT id, id, ARRAY[]::integer[] FROM tasks
            WHERE parent_task_id IS NULL AND is_deleted = false
            UNION ALL
            SELECT t.id, c.root_id, c.path || t.sort_order
            FROM tasks AS t
            JOIN chain AS c ON t.parent_task_id = c.id
            WHERE t.is_deleted = false
        ),
        target AS (
            SELECT s.id, s.workspace_id, r.id AS root_id,
                   r.project_id AS project_id, r.section_id AS section_id,
                   CASE WHEN s.parent_task_id <> r.id THEN
                       COALESCE((SELECT MAX(k.sort_order) FROM tasks AS k
                                 WHERE k.parent_task_id = r.id AND k.is_deleted = false), 0)
                       + 1000 * ROW_NUMBER() OVER (
                           PARTITION BY r.id, (s.parent_task_id <> r.id)
                           ORDER BY c.path, s.id)
                   END AS new_sort_order
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
            sort_order = COALESCE(t.new_sort_order, s.sort_order),
            version = b.version
        FROM target AS t, bumped AS b
        WHERE s.id = t.id
          AND b.id = t.workspace_id
        """
    )


def downgrade() -> None:
    # Data-only: the previous (diverged) values are not recoverable and not needed.
    pass
