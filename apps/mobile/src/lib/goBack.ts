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
 */
export function leaveGate(href: Href): void {
  const canDismiss = router.canDismiss();
  if (canDismiss) router.dismissAll();
  if (href === '/today' && canDismiss) return;
  router.replace(href);
}
