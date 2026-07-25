// Collaboration helpers for the mobile UI (contract v1.2 §3.4, §4).
//
// The comment ordering/counting and the §3.4 role rules now live in
// @balu/domain (D4/D5) — web and mobile used to carry separate copies that
// ordered same-second comments differently. This module keeps the mobile-facing
// signatures (which take a sync-client `Snapshot`) plus the assignee initials.
import { commentCountsByTask as countsOf, commentsForTask as forTask } from '@balu/domain';
import type { Comment } from '@balu/domain';
import type { Snapshot } from '@balu/sync-client';

export {
  canComment,
  canDeleteComment,
  canEditComment,
  compareCommentAsc,
} from '@balu/domain';

/** Comments of one task, non-deleted, ordered `created_at` asc then id (§3.4). */
export function commentsForTask(snap: Snapshot, taskId: string): Comment[] {
  return forTask(snap.comments, taskId);
}

/** Open-comment counts per task id, for the row chip. */
export function commentCountsByTask(snap: Snapshot): Map<string, number> {
  return countsOf(snap.comments);
}

/** Two-letter initials from a display name, for the assignee chip. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
