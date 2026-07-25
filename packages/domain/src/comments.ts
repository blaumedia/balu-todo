// Comment thread helpers (contract §3.4, v1.2).

import type { Comment } from "./types.js";

/**
 * Stable ordering by `created_at` ascending, tie-broken by id (contract §3.4).
 * The id tie-break matters: comments created within the same second used to
 * order unstably (I9).
 */
export function compareCommentAsc(a: Comment, b: Comment): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

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
    .sort(compareCommentAsc);
}

/** Open-comment counts per task id, for row chips. */
export function commentCountsByTask(comments: ReadonlyArray<Comment>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of comments) {
    if (c.is_deleted) continue;
    counts.set(c.task_id, (counts.get(c.task_id) ?? 0) + 1);
  }
  return counts;
}
