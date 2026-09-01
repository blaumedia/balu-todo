// `task_move` container math (contract §3.3, §5.4) - the shared client truth
// for moving a task to another project body or section.

import type { Task, TaskMoveArgs } from "./types.js";
import { nextSortOrder } from "./helpers.js";

/** A `task_move` destination: a project body, or one of its sections. */
export interface MoveTarget {
  project_id: string | null;
  section_id: string | null;
}

/**
 * The tasks that count for `target`: its live (not soft-deleted), top-level
 * rows - completed tasks included, because the server's container ordering
 * includes them.
 *
 * `snapshot.tasks` still carries soft-deleted rows (the sync-client's
 * buildSnapshot does not filter them), so the `is_deleted` check is required.
 * Subtasks are excluded because a subtask's container is its parent task
 * (contract §3.3), never a project or section.
 */
export function containerTasks(tasks: readonly Task[], target: MoveTarget): Task[] {
  return tasks.filter(
    (t) =>
      !t.is_deleted &&
      t.parent_task_id == null &&
      t.project_id === target.project_id &&
      (target.section_id == null ? t.section_id == null : t.section_id === target.section_id),
  );
}

/**
 * `task_move` args for moving `task` into `target`, or `null` when the task is
 * already there. No-op moves are never sent: they would be a pointless version
 * bump on every synced object.
 *
 * Both container fields are always named, never one: the server clears
 * `section_id` when `project_id` changes without a `section_id`
 * (`h_task_move`), and the optimistic mirror applies that same rule
 * (sync-client apply). Naming both keeps server and replica in agreement by
 * construction.
 *
 * `sort_order` is always sent too: the server keeps the old value when it is
 * absent, and the old value is another container's ordering. Appending is
 * `max + 1000` of the destination (contract §3.3, `nextSortOrder`).
 */
export function moveTaskArgs(task: Task, target: MoveTarget, tasks: readonly Task[]): TaskMoveArgs | null {
  if (task.project_id === target.project_id && task.section_id === target.section_id) return null;
  const siblings = containerTasks(tasks, target).filter((t) => t.id !== task.id);
  return {
    id: task.id,
    project_id: target.project_id,
    section_id: target.section_id,
    sort_order: nextSortOrder(siblings),
  };
}
