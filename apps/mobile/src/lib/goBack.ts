import { router, type Href } from 'expo-router';

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

/**
 * Hand over to the index gate with no history left behind.
 *
 * `replace` alone only swaps the top route: with `[(tabs), assigned]` the stack
 * would become `[(tabs), index]`, and Android back from the login step would
 * return to a tab with no session. Dismissing the stack first leaves nothing to
 * go back to, the same way boot's own navigation to onboarding does.
 */
export function replaceWithGate(): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace('/');
}

/**
 * Leave the index gate for its destination with exactly one root screen left.
 *
 * The root anchor makes the cold-start stack `[(tabs), index]`. A plain replace
 * would give `[(tabs), onboarding]` (Back reveals a tab with no session) or
 * `[(tabs), (tabs)]`. Dismissing first leaves `[(tabs)]`, which the replace swaps.
 */
export function leaveGate(href: Href): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}
