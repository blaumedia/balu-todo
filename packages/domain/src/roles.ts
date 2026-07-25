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

/**
 * May `actor` **remove** `target` (§7: `DELETE …/members/{id}`)?
 *
 * Mirrors the server: you may not act on someone ranked above you, but peers may
 * act on each other (otherwise a co-owner could never be removed). Leaving —
 * removing yourself — needs no rank at all; the last-owner guard is what keeps a
 * workspace governable.
 */
export function canRemoveMember(
  actorRole: Role | null | undefined,
  targetRole: Role,
  isSelf: boolean,
): boolean {
  if (isSelf) return true;
  if (!canManageMembers(actorRole)) return false;
  return rankOf(actorRole) >= rankOf(targetRole);
}

/**
 * May `actor` **change** `target`'s role (§7: `PATCH …/members/{id}`)?
 *
 * Unlike removal, this needs admin rank even on yourself — the server checks
 * `role >= admin` *before* the self-allowance, so a member cannot self-promote.
 * Treating self as unconditionally allowed (the first cut) described a server
 * that does not exist; it was only invisible because a member has no assignable
 * roles to pick from anyway.
 */
export function canChangeMemberRole(
  actorRole: Role | null | undefined,
  targetRole: Role,
  isSelf: boolean,
): boolean {
  if (!canManageMembers(actorRole)) return false;
  if (isSelf) return true; // stepping down / handing over ownership
  return rankOf(actorRole) >= rankOf(targetRole);
}

/** The roles `actorRole` is allowed to assign (§7: only owners grant owner). */
export function assignableRoles(actorRole: Role | null | undefined): Role[] {
  if (!canManageMembers(actorRole)) return [];
  const base: Role[] = ["admin", "member", "viewer"];
  return actorRole === "owner" ? ["owner", ...base] : base;
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
