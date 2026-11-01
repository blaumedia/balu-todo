import { beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: vi.fn(),
  canDismiss: vi.fn(),
  dismissAll: vi.fn(),
}));
vi.mock('expo-router', () => ({ router }));

import { canDismissState, gateTarget, goBackOr, leaveForOnboarding, leaveGate, needsOnboardingRedirect } from '../src/lib/goBack';

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

describe('leaveGate', () => {
  it('clears the anchor stack before replacing, so one root screen is left', () => {
    leaveGate('/onboarding', true);
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/onboarding');
    expect(router.dismissAll.mock.invocationCallOrder[0]).toBeLessThan(
      router.replace.mock.invocationCallOrder[0]!,
    );
  });

  it('dismisses alone for the app: the anchor already is (tabs)/Today', () => {
    leaveGate('/today', true);
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('only replaces when there is nothing to dismiss', () => {
    leaveGate('/today', false);
    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/today');
  });

  it('trusts the given answer, not the router store (which lags on a cold start)', () => {
    router.canDismiss.mockReturnValue(false);
    leaveGate('/onboarding', true);
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.canDismiss).not.toHaveBeenCalled();
  });
});

describe('canDismissState', () => {
  const stack = (...names: string[]) => ({ type: 'stack', index: names.length - 1, routes: names.map((name) => ({ name })) });

  it('is true when the focused stack holds more than one screen', () => {
    const root = { type: 'stack', index: 0, routes: [{ state: stack('(tabs)', 'index') }] };
    expect(canDismissState(root)).toBe(true);
  });

  it('is false for a single root screen, or no state yet', () => {
    expect(canDismissState({ type: 'stack', index: 0, routes: [{ state: stack('onboarding') }] })).toBe(false);
    expect(canDismissState(undefined)).toBe(false);
  });

  it('finds a deeper stack: one root screen whose focused tab holds a two-screen stack', () => {
    const root = { type: 'stack', index: 0, routes: [{ state: { type: 'tab', index: 0, routes: [{ state: stack('a', 'b') }] } }] };
    expect(canDismissState(root)).toBe(true);
  });

  it('is false after a logout dismissed down to the tabs (root [(tabs)] with single-screen tab stacks)', () => {
    const tabs = { type: 'tab', index: 0, routes: [{ name: 'today' }, { name: 'browse' }] };
    const app = { type: 'stack', index: 0, routes: [{ name: '(tabs)', state: tabs }] };
    const root = { type: 'stack', index: 0, routes: [{ state: app }] };
    expect(canDismissState(root)).toBe(false);
  });

  it('walks to the focused route only', () => {
    const tabs = { type: 'tab', index: 1, routes: [{ state: stack('a', 'b') }, { state: stack('c') }] };
    expect(canDismissState({ type: 'stack', index: 0, routes: [{ state: tabs }] })).toBe(false);
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

describe('leaveForOnboarding (the root layout effect)', () => {
  it('navigates once for a pushed screen when logged out', () => {
    const nav = vi.fn();
    expect(leaveForOnboarding('onboarding', ['settings'], nav)).toBe(true);
    expect(nav).toHaveBeenCalledTimes(1);
  });

  it('leaves the gate, onboarding itself and other boot states alone', () => {
    const nav = vi.fn();
    expect(leaveForOnboarding('onboarding', [], nav)).toBe(false);
    expect(leaveForOnboarding('onboarding', ['onboarding'], nav)).toBe(false);
    expect(leaveForOnboarding('ready', ['settings'], nav)).toBe(false);
    expect(nav).not.toHaveBeenCalled();
  });
});
