// Role capabilities (contract §2, §3.4, §7).
//
// Web (`canWrite`, `canManageMembers`), mobile (`canComment`, `canEditComment`,
// `canDeleteComment`) and the server's ROLE_RANK each encoded these rules
// separately (D4). This is the one client-side source.

import type { Comment, Role } from "./types.js";

/** Mirrors the server's `balu.sync.engine.ROLE_RANK`. */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function rankOf(role: Role | null | undefined): number {
  return role == null ? -1 : ROLE_RANK[role];
}

/** Viewers are read-only (§2) — every mutation affordance hides/disables. */
export function canWrite(role: Role | null | undefined): boolean {
  return rankOf(role) >= ROLE_RANK.member;
}

/** Members management + invites require admin or owner (§7). */
export function canManageMembers(role: Role | null | undefined): boolean {
  return rankOf(role) >= ROLE_RANK.admin;
}

/** Commenting is a write (§3.4). */
export function canComment(role: Role | null | undefined): boolean {
  return canWrite(role);
}

/** Only the author may edit a comment (§3.4). */
export function canEditComment(comment: Comment, userId: string | null): boolean {
  return userId != null && comment.author_id === userId;
}

/** The author or an admin+ may delete a comment (§3.4). */
export function canDeleteComment(
  comment: Comment,
  userId: string | null,
  role: Role | null | undefined,
): boolean {
  return canEditComment(comment, userId) || canManageMembers(role);
}
