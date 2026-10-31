import { beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn(), canGoBack: vi.fn() }));
vi.mock('expo-router', () => ({ router }));

import { goBackOr, shouldLeaveAssigned } from '../src/lib/goBack';

beforeEach(() => vi.clearAllMocks());

describe('goBackOr', () => {
  it('replaces with the fallback when there is no history', () => {
    router.canGoBack.mockReturnValue(false);
    goBackOr('/browse');
    expect(router.replace).toHaveBeenCalledWith('/browse');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('goes back when there is history', () => {
    router.canGoBack.mockReturnValue(true);
    goBackOr('/browse');
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('defaults the fallback to /browse', () => {
    router.canGoBack.mockReturnValue(false);
    goBackOr();
    expect(router.replace).toHaveBeenCalledWith('/browse');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('uses a screen navigation when given one', () => {
    const nav = { canGoBack: vi.fn(() => true), goBack: vi.fn() };
    goBackOr('/browse', nav);
    expect(nav.goBack).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.canGoBack).not.toHaveBeenCalled();
    nav.canGoBack.mockReturnValue(false);
    goBackOr('/browse', nav);
    expect(router.replace).toHaveBeenCalledWith('/browse');
    expect(nav.goBack).toHaveBeenCalledTimes(1);
  });
});

describe('shouldLeaveAssigned', () => {
  const ready = { boot: 'ready', status: 'synced', hasUser: true, memberCount: 2 };
  it('does not bounce a cold deep link while boot is loading', () => {
    expect(shouldLeaveAssigned({ boot: 'loading', status: 'offline', hasUser: false, memberCount: 0 })).toBe(false);
  });
  it('does not bounce before the data is synced', () => {
    expect(shouldLeaveAssigned({ ...ready, status: 'syncing', memberCount: 0 })).toBe(false);
  });
  it('stays in a shared workspace', () => {
    expect(shouldLeaveAssigned(ready)).toBe(false);
  });
  it('leaves a solo workspace or a missing user once confirmed', () => {
    expect(shouldLeaveAssigned({ ...ready, memberCount: 1 })).toBe(true);
    expect(shouldLeaveAssigned({ ...ready, hasUser: false })).toBe(true);
  });
  it('leaves when boot resolves to logged out', () => {
    expect(shouldLeaveAssigned({ boot: 'onboarding', status: 'offline', hasUser: false, memberCount: 0 })).toBe(true);
  });
});
