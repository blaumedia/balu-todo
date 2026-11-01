import { beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: vi.fn(),
  canDismiss: vi.fn(),
  dismissAll: vi.fn(),
}));
vi.mock('expo-router', () => ({ router }));

import { gateTarget, goBackOr, leaveGate, needsOnboardingRedirect, replaceWithGate } from '../src/lib/goBack';

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

describe('replaceWithGate', () => {
  it('clears the stack before handing over to the index gate', () => {
    router.canDismiss.mockReturnValue(true);
    replaceWithGate();
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.dismissAll.mock.invocationCallOrder[0]).toBeLessThan(
      router.replace.mock.invocationCallOrder[0]!,
    );
  });

  it('only replaces when there is nothing to dismiss (cold deep link)', () => {
    router.canDismiss.mockReturnValue(false);
    replaceWithGate();
    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/');
  });
});

describe('leaveGate', () => {
  it('clears the anchor stack before replacing, so one root screen is left', () => {
    router.canDismiss.mockReturnValue(true);
    leaveGate('/onboarding');
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/onboarding');
    expect(router.dismissAll.mock.invocationCallOrder[0]).toBeLessThan(
      router.replace.mock.invocationCallOrder[0]!,
    );
  });

  it('dismisses alone for the app: the anchor already is (tabs)/Today', () => {
    router.canDismiss.mockReturnValue(true);
    leaveGate('/today');
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('only replaces when there is nothing to dismiss', () => {
    router.canDismiss.mockReturnValue(false);
    leaveGate('/today');
    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/today');
  });
});

describe('gateTarget', () => {
  it('waits while boot is unresolved, and picks the destination otherwise', () => {
    expect(gateTarget('loading')).toBeNull();
    expect(gateTarget('reconnecting')).toBeNull();
    expect(gateTarget('noWorkspace')).toBeNull();
    expect(gateTarget('onboarding')).toBe('/onboarding');
    expect(gateTarget('ready')).toBe('/today');
  });
});

describe('needsOnboardingRedirect', () => {
  it('redirects a logged-out boot with a pushed screen in front', () => {
    expect(needsOnboardingRedirect('onboarding', ['settings'])).toBe(true);
    expect(needsOnboardingRedirect('onboarding', ['project', '[id]'])).toBe(true);
    expect(needsOnboardingRedirect('onboarding', ['(tabs)', 'today'])).toBe(true);
  });

  it('leaves the gate, onboarding and every other boot state alone', () => {
    expect(needsOnboardingRedirect('onboarding', [])).toBe(false);
    expect(needsOnboardingRedirect('onboarding', ['onboarding'])).toBe(false);
    expect(needsOnboardingRedirect('loading', ['settings'])).toBe(false);
    expect(needsOnboardingRedirect('ready', ['settings'])).toBe(false);
  });
});
