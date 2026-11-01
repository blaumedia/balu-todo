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
 * "GO_BACK was not handled"). `/browse` is the default fallback: it is the tab
 * that lists the lists, projects and labels most of these screens are pushed
 * from. Screens with another origin (Settings: `/today`) pass their own.
 *
 * Pass `nav` to pop that screen's own stack instead of the global router.
 */
export function goBackOr(fallback: Href = '/browse', nav?: BackNav): void {
  const target: BackNav = nav ?? { canGoBack: () => router.canGoBack(), goBack: () => router.back() };
  if (target.canGoBack()) target.goBack();
  else router.replace(fallback);
}
