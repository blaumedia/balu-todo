// Comment thread helpers (contract §3.4, v1.2).

import type { Comment } from "./types.js";

/**
 * Live comments for a task, ordered `created_at` ascending (contract §3.4),
 * with soft-deleted entries excluded.
 */
export function commentsForTask(
  comments: ReadonlyArray<Comment>,
  taskId: string,
): Comment[] {
  return comments
    .filter((c) => c.task_id === taskId && !c.is_deleted)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}
