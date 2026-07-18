import type { Role } from "@balu/domain";
import { useApp } from "../store/app.js";

/** The signed-in user's role in the active workspace (null before boot). */
export function useMyRole(): Role | null {
  const workspace = useApp((s) => s.workspace);
  const memberships = useApp((s) => s.memberships);
  if (!workspace) return null;
  return memberships.find((m) => m.workspace.id === workspace.id)?.role ?? null;
}

/** Viewers are read-only (contract §2) — every mutation affordance hides/disables. */
export function canWrite(role: Role | null): boolean {
  return role != null && role !== "viewer";
}

/** Members management + invites require admin or owner (contract §7). */
export function canManageMembers(role: Role | null): boolean {
  return role === "admin" || role === "owner";
}
