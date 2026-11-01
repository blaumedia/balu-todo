import { describe, expect, it } from 'vitest';
import { shouldLeaveAssigned } from '../src/lib/assigned';

describe('shouldLeaveAssigned', () => {
  const ready = { boot: 'ready', status: 'synced', hasUser: true, memberCount: 2 } as const;
  it('does not bounce a cold deep link while boot is loading', () => {
    expect(shouldLeaveAssigned({ boot: 'loading', status: 'offline', hasUser: false, memberCount: 0 })).toBeNull();
  });
  it('does not bounce before the data is synced', () => {
    expect(shouldLeaveAssigned({ ...ready, status: 'syncing', memberCount: 0 })).toBeNull();
  });
  it('stays in a shared workspace', () => {
    expect(shouldLeaveAssigned(ready)).toBeNull();
  });
  it('goes back from a solo workspace or a missing user once confirmed', () => {
    expect(shouldLeaveAssigned({ ...ready, memberCount: 1 })).toBe('back');
    expect(shouldLeaveAssigned({ ...ready, hasUser: false })).toBe('back');
  });
  it('stays when boot resolves to logged out (the root layout redirects)', () => {
    expect(shouldLeaveAssigned({ boot: 'onboarding', status: 'offline', hasUser: false, memberCount: 0 })).toBeNull();
  });
});
