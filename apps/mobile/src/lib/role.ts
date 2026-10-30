// Who the signed-in user is in the active workspace (contract §2).
//
// The synced replica is the live source: a role change made while the app is
// open arrives through sync. The /me memberships cover the moment before the
// replica has loaded - they are set together with the session when online, but
// are empty after an offline boot (lib/boot.ts), where the persisted replica
// fills in instead. The predicates themselves (canWrite, ...) stay in
// @balu/domain.
import { canWrite, type Member, type Role, type Workspace } from '@balu/domain';

export interface RoleSources {
  userId: string | null | undefined;
  workspaceId: string | null | undefined;
  members: ReadonlyArray<Pick<Member, 'id' | 'role'>>;
  memberships: ReadonlyArray<{ role: Role; workspace: Pick<Workspace, 'id'> }>;
}

/**
 * The user's role, or null while it is unknown. Once the replica has loaded it
 * always contains the user, so a missing own record then means null (not the
 * /me role); /me is only the fallback while the replica is still empty.
 */
export function resolveMyRole({ userId, workspaceId, members, memberships }: RoleSources): Role | null {
  if (!userId) return null;
  const record = members.find((m) => m.id === userId);
  if (record) return record.role;
  if (members.length > 0) return null;
  if (!workspaceId) return null;
  return memberships.find((m) => m.workspace.id === workspaceId)?.role ?? null;
}

/**
 * Whether the tabs show the add button. Hidden for read-only members (viewers,
 * contract §2 - the server rejects their task_add as forbidden). Shown while the
 * role is still unknown (null): that only happens on an offline cold start
 * before the replica has loaded, and a writer's main entry point flickering
 * away is worse than a viewer seeing it for a moment (the server still rejects).
 */
export function canQuickAddFromTabs(role: Role | null): boolean {
  return role == null || canWrite(role);
}
