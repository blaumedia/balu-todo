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
  members: readonly Pick<Member, 'id' | 'role'>[];
  memberships: readonly { role: Role; workspace: Pick<Workspace, 'id'> }[];
}

/**
 * The user's role, or null while it is unknown. Once the replica has loaded it
 * always contains the user, so a missing own record then means null (not the
 * /me role); /me is only the fallback while the replica is still empty. A
 * removed member does not get a replica without their own record: the server
 * rejects their sync with 403 (membership check), so the client goes into an
 * error status and keeps its last role. Treating that 403 as revoked
 * membership is a separate follow-up.
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
 * Whether a write sheet (quick add, schedule) that is open must close because
 * the role dropped under it. Only when the role is known and read-only: an
 * unknown (null) role keeps the fail-open semantics of canQuickAddFromTabs, so
 * a transient gap in the replica never closes a writer's sheet.
 */
export function shouldCloseWriteSheet(role: Role | null): boolean {
  return role != null && !canWrite(role);
}

/**
 * Whether the tabs show the add button. Hidden for read-only members (viewers,
 * contract §2 - the server rejects their task_add as forbidden). Shown while the
 * role is unknown (null): normally an offline cold start before the replica has
 * loaded; also no signed-in user. A writer's main entry point flickering away is
 * worse than a viewer seeing it briefly (the server still rejects).
 */
export function canQuickAddFromTabs(role: Role | null): boolean {
  return role == null || canWrite(role);
}
