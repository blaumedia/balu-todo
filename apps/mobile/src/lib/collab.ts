// Collaboration helpers for the mobile UI (contract v1.2 §3.4, §4).
//
// The shared data model — the `Comment` type, the `comments` array on the
// sync-client Snapshot, and the `'assigned'` smart list — lives in
// @balu/domain / @balu/sync-client (plan 08). This module holds only the
// mobile-specific view logic layered on top: comment ordering/counting for the
// row + sheet, the role rules from §3.4, and the assignee-chip initials.
import type { Snapshot } from '@balu/sync-client';
import type { Comment, Role } from '@balu/domain';

/** Comments of one task, non-deleted, ordered `created_at` ascending (§3.4). */
export function commentsForTask(snap: Snapshot, taskId: string): Comment[] {
  return snap.comments
    .filter((c) => c.task_id === taskId && !c.is_deleted)
    .sort(compareCommentAsc);
}

/** Stable ordering by `created_at` asc, tie-broken by id (§3.4). */
export function compareCommentAsc(a: Comment, b: Comment): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Open-comment counts per task id, for the row chip. */
export function commentCountsByTask(snap: Snapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of snap.comments) {
    if (c.is_deleted) continue;
    counts.set(c.task_id, (counts.get(c.task_id) ?? 0) + 1);
  }
  return counts;
}

// ── Role rules (contract §3.4): viewer read-only; member+ can comment;
// edit only by author; delete by author or admin+ ────────────────────────
const ADMIN_ROLES: ReadonlySet<Role> = new Set<Role>(['owner', 'admin']);

export function canComment(role: Role | undefined): boolean {
  return role != null && role !== 'viewer';
}

export function canEditComment(comment: Comment, userId: string | null): boolean {
  return userId != null && comment.author_id === userId;
}

export function canDeleteComment(
  comment: Comment,
  userId: string | null,
  role: Role | undefined,
): boolean {
  if (userId != null && comment.author_id === userId) return true;
  return role != null && ADMIN_ROLES.has(role);
}

/** Two-letter initials from a display name, for the assignee chip. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
