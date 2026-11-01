import type { SyncStatus } from '@balu/domain';
import type { Boot } from '../store/app';

/**
 * What the Assigned screen should do:
 * - `'back'`: solo workspace or missing user, once boot is ready and synced;
 *   before that `user` is null and the member list empty, which would bounce a
 *   cold deep link.
 * - `null`: stay (logged out is handled by the root layout's redirect).
 */
export function shouldLeaveAssigned(s: {
  boot: Boot;
  status: SyncStatus;
  hasUser: boolean;
  memberCount: number;
}): 'back' | null {
  if (s.boot !== 'ready' || s.status !== 'synced') return null;
  return !s.hasUser || s.memberCount <= 1 ? 'back' : null;
}
