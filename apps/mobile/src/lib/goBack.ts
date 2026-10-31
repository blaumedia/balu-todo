import { router, type Href } from 'expo-router';

/** A screen's own navigation object (what `useNavigation()` returns). */
export interface BackNav {
  canGoBack(): boolean;
  goBack(): void;
}

/**
 * Go back when there is history, otherwise land on a root screen.
 *
 * A pushed screen opened by a deep link or notification (or restored after the
 * process died) is the first screen of its stack, so a bare `back()` has
 * nothing to pop and does nothing, or exits the app on Android. `/browse` is
 * the fallback everywhere: it is the tab that lists the lists, projects and
 * labels these screens are pushed from.
 *
 * Pass `nav` to pop that screen's own stack instead of the global router.
 */
export function goBackOr(fallback: Href = '/browse', nav?: BackNav): void {
  const target: BackNav = nav ?? { canGoBack: () => router.canGoBack(), goBack: () => router.back() };
  if (target.canGoBack()) target.goBack();
  else router.replace(fallback);
}
