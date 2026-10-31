import type { Role } from "@balu/domain";
import type { AppState } from "../store/app.js";
import { useApp } from "../store/app.js";

// The role rules themselves live in @balu/domain (D4) so web, mobile and the
// server's ROLE_RANK cannot drift; this module only adds the React binding.
export {
  canComment,
  canDeleteComment,
  canEditComment,
  canManageMembers,
  canWrite,
} from "@balu/domain";

/** The user's role in the active workspace, from a store state (null before boot). */
export function roleIn(s: Pick<AppState, "workspace" | "memberships">): Role | null {
  if (!s.workspace) return null;
  const id = s.workspace.id;
  return s.memberships.find((m) => m.workspace.id === id)?.role ?? null;
}

/** The signed-in user's role in the active workspace (null before boot). */
export function useMyRole(): Role | null {
  const workspace = useApp((s) => s.workspace);
  const memberships = useApp((s) => s.memberships);
  return roleIn({ workspace, memberships });
}
