import type { Role } from "@balu/domain";
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

/** The signed-in user's role in the active workspace (null before boot). */
export function useMyRole(): Role | null {
  const workspace = useApp((s) => s.workspace);
  const memberships = useApp((s) => s.memberships);
  if (!workspace) return null;
  return memberships.find((m) => m.workspace.id === workspace.id)?.role ?? null;
}
