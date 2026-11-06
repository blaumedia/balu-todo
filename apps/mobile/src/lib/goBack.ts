import { router, type Href } from 'expo-router';
import type { Boot } from '../store/app';

/** A screen's own navigation object (what `useNavigation()` returns). */
export interface BackNav {
  canGoBack(): boolean;
  goBack(): void;
}

/**
 * Go back when there is history, otherwise land on a root screen.
 *
 * A pushed screen opened by a deep link or notification is the first screen of
 * its stack, so a bare `back()` has nothing to pop and does nothing (dev:
 * "GO_BACK was not handled"). The root layout's `(tabs)` anchor normally gives
 * those screens a tab below them (Back then lands on Today, like hardware Back),
 * so this fallback is a safety net. `/browse` is the default: it lists the lists,
 * projects and labels most of these screens are pushed from. Screens with another
 * origin (Settings: `/today`) pass their own.
 *
 * Pass `nav` to pop that screen's own stack instead of the global router.
 */
export function goBackOr(fallback: Href = '/browse', nav?: BackNav): void {
  const target: BackNav = nav ?? { canGoBack: () => router.canGoBack(), goBack: () => router.back() };
  if (target.canGoBack()) target.goBack();
  else router.replace(fallback);
}

/** Where the index gate sends the app for a boot state: '/today', '/onboarding', or null to keep waiting. */
export function gateTarget(boot: Boot): Href | null {
  if (boot === 'ready') return '/today';
  if (boot === 'onboarding') return '/onboarding';
  return null;
}

/**
 * A logged-out boot with a pushed screen in front (cold deep link, or /me refusing
 * the session): that screen sits on the (tabs) anchor with no session. True when
 * the focused route is neither the gate (no segment) nor onboarding.
 */
export function needsOnboardingRedirect(boot: Boot, segments: readonly string[]): boolean {
  return boot === 'onboarding' && segments.length > 0 && segments[0] !== 'onboarding';
}

/**
 * The one owner of "leave for onboarding" past the gate: the root layout runs this
 * from an effect on boot and segments. Whoever ends the session only sets boot
 * 'onboarding'; at the gate (no segment) the index gate navigates instead.
 * Returns whether it navigated.
 */
export function leaveForOnboarding(boot: Boot, segments: readonly string[], navigate: () => void): boolean {
  if (!needsOnboardingRedirect(boot, segments)) return false;
  navigate();
  return true;
}

/**
 * Leave the index gate for its destination with exactly one root screen left.
 *
 * The root anchor makes the cold-start stack `[(tabs), index]`. For the app itself
 * the anchor already is `(tabs)`/Today, so dismissing is enough (a replace would
 * remount the tabs); replace only when nothing is below. For onboarding a plain
 * replace would give `[(tabs), onboarding]` (Back reveals a tab with no session),
 * so dismiss first and let the replace swap the one root screen left.
 *
 * `canDismiss` comes from the gate screen's own navigation state, not from
 * `router.canDismiss()`: that reads the router store, which has not seen the
 * first stack state yet when the gate's effect runs on a cold start (it answers
 * false), so the replace alone left a hidden `(tabs)` below the destination and
 * the first Back press appeared to do nothing (e2e dce0f6d0 F1).
 */
export function leaveGate(href: Href, canDismiss: boolean): void {
  try {
    if (canDismiss) router.dismissAll();
    if (href === '/today' && canDismiss) return;
    router.replace(href);
  } catch (e) {
    // The imperative router is unbound while its root is torn down: this gate's effect
    // can still run after an activity recreation (font scale, density) destroyed the
    // surface, and an uncaught throw in an effect kills the process. The surface that
    // replaces it mounts a fresh gate, which navigates then (router rebinding relies on
    // patches/expo-router@58.0.30.patch). Logged so a blank gate screen is diagnosable.
    console.warn('leaveGate: imperative router unavailable', e);
  }
}

/** Minimal shape of a navigation state, enough to walk down to the focused stack. */
export interface NavStateLike {
  type?: string;
  index?: number;
  routes?: readonly { name?: string; state?: NavStateLike }[];
}

/**
 * Whether the focused stack has a screen to pop, read from a live navigation state
 * (`navigationRef.getRootState()`). Same walk as `router.canDismiss()`, which reads a
 * router store that lags behind the real state (e2e dce0f6d0 F1).
 */
export function canDismissState(state: NavStateLike | undefined): boolean {
  let s = state;
  while (s) {
    if (s.type === 'stack' && (s.routes?.length ?? 0) > 1) return true;
    if (s.index === undefined) return false;
    s = s.routes?.[s.index]?.state;
  }
  return false;
}
