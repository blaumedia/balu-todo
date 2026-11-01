import type { SyncStatus } from '@balu/domain';
import type { Boot } from '../store/app';

/**
 * What the Assigned screen should do:
 * - `'gate'`: boot resolved to logged out (`onboarding`); clear the stack and
 *   replace to `/` so the index gate picks onboarding (popping back would land
 *   on a tab with no session).
 * - `'back'`: solo workspace or missing user, once boot is ready and synced;
 *   before that `user` is null and the member list empty, which would bounce a
 *   cold deep link.
 * - `null`: stay.
 */
export function shouldLeaveAssigned(s: {
  boot: Boot;
  status: SyncStatus;
  hasUser: boolean;
  memberCount: number;
}): 'gate' | 'back' | null {
  if (s.boot === 'onboarding') return 'gate';
  if (s.boot !== 'ready' || s.status !== 'synced') return null;
  return !s.hasUser || s.memberCount <= 1 ? 'back' : null;
}
