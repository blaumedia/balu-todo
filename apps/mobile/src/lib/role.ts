// Who the signed-in user is in the active workspace (contract §2).
//
// The synced replica is the live source: a role change made while the app is
// open arrives through sync. The /me memberships cover the moment before the
// replica has loaded - they are set together with the session when online, but
// are empty after an offline boot (lib/boot.ts), where the persisted replica
// fills in instead. The predicates themselves (canWrite, ...) stay in
// @balu/domain.
import type { Member, Role, Workspace } from '@balu/domain';

export interface RoleSources {
  userId: string | null | undefined;
  workspaceId: string | null | undefined;
  members: ReadonlyArray<Pick<Member, 'id' | 'role' | 'is_deleted'>>;
  memberships: ReadonlyArray<{ role: Role; workspace: Pick<Workspace, 'id'> }>;
}

/**
 * The user's role, or null while it is unknown. A deleted member record means
 * the user was removed - null, not the stale /me role.
 */
export function resolveMyRole({ userId, workspaceId, members, memberships }: RoleSources): Role | null {
  if (!userId) return null;
  const record = members.find((m) => m.id === userId);
  if (record) return record.is_deleted ? null : record.role;
  if (!workspaceId) return null;
  return memberships.find((m) => m.workspace.id === workspaceId)?.role ?? null;
}
