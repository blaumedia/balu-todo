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

/**
 * Whether the Assigned screen should leave: only once the data is confirmed
 * (boot ready and synced), because before that `user` is null and the member
 * list is empty, which would bounce a cold deep link. A logged-out boot
 * (`onboarding`) leaves at once; the caller falls back to `/` so the index
 * gate picks onboarding or `/today`.
 */
export function shouldLeaveAssigned(s: { boot: string; status: string; hasUser: boolean; memberCount: number }): boolean {
  if (s.boot === 'onboarding') return true;
  if (s.boot !== 'ready' || s.status !== 'synced') return false;
  return !s.hasUser || s.memberCount <= 1;
}
