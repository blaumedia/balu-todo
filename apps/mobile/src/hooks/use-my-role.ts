import { canWrite, type Role } from '@balu/domain';
import { resolveMyRole } from '../lib/role';
import { useApp } from '../store/app';
import { useSnapshot } from '../store/useSnapshot';

/** The signed-in user's role in the active workspace; null while unknown (see resolveMyRole). */
export function useMyRole(): Role | null {
  const userId = useApp((s) => s.user?.id ?? null);
  const workspaceId = useApp((s) => s.workspace?.id ?? null);
  const memberships = useApp((s) => s.memberships);
  const { members } = useSnapshot();
  return resolveMyRole({ userId, workspaceId, members, memberships });
}

/** May the user write? False for viewers and while the role is unknown (§2). */
export function useWritable(): boolean {
  return canWrite(useMyRole());
}
