import type { Locale, User } from '@balu/domain';
import type { SyncClient } from '@balu/sync-client';
import { useApp } from '../store/app';
import { getApi } from './clients';
import { SETTINGS, sqliteKV } from './kv';

/**
 * The user picked a language: apply it, remember it locally and tell the server.
 *
 * The server copy (PATCH /me) is best effort, so the choice stays marked pending
 * until the server confirmed it. Without that mark the next boot could not tell
 * "the user chose this offline" from "another device changed it", and /me's
 * user.locale (still the old language) would win over the choice.
 */
export function chooseLocale(locale: Locale): void {
  useApp.getState().setLocale(locale);
  void sqliteKV.setItem(SETTINGS.localePending, '1');
  pushLocale(locale);
}

// PATCHes run one at a time: two quick choices (en, then de) must reach the server in
// that order, or an older request applied last would leave the wrong language there
// while the newer one's response had already cleared the pending mark.
let pushChain: Promise<void> = Promise.resolve();

function pushLocale(locale: Locale): void {
  pushChain = pushChain.then(async () => {
    // No client (logged out, or not built yet): nothing was sent, so the mark stays.
    const api = getApi();
    if (!api) return;
    try {
      await api.patchMe({ locale });
      // A newer choice made while this request was in flight stays pending.
      if (useApp.getState().locale === locale) await sqliteKV.removeItem(SETTINGS.localePending);
    } catch {
      /* stays pending for the next retry */
    }
  });
}

/**
 * Send the saved choice again if the server never confirmed it. Called when the
 * app returns to the foreground and when sync reconnects, so a long session that
 * booted offline does not leave the server (and the web app) on the old language.
 */
export async function retryPendingLocale(): Promise<void> {
  if (!useApp.getState().user) return;
  const [stored, pending] = await Promise.all([
    sqliteKV.getItem(SETTINGS.locale),
    sqliteKV.getItem(SETTINGS.localePending),
  ]);
  if (pending === '1' && (stored === 'de' || stored === 'en')) pushLocale(stored);
}

/**
 * Retry the pending choice when `sync` comes back online after a down state seen
 * since subscribing. A fresh client starts offline and connects on its own: that
 * first connect is not a reconnect (the boot already sent the choice), so only an
 * offline/error observed after subscribing arms the retry. Returns the unsubscribe.
 */
export function retryLocaleOnReconnect(sync: Pick<SyncClient, 'getStatus' | 'subscribe'>): () => void {
  let wasDown = false;
  return sync.subscribe(() => {
    const status = sync.getStatus();
    const down = status === 'offline' || status === 'error';
    if (wasDown && !down) void retryPendingLocale();
    wasDown = down;
  });
}

/**
 * Wire the retries: the app returning to the foreground, and every sync client's
 * reconnect (the previous client's watcher is dropped when the client is swapped
 * or torn down). Returns the cleanup that removes all of it.
 */
export function watchLocaleRetries(deps: {
  onAppStateChange: (cb: (state: string) => void) => { remove(): void };
  subscribeSyncClient: (cb: (client: SyncClient | null) => void) => () => void;
}): () => void {
  const sub = deps.onAppStateChange((state) => {
    if (state === 'active') void retryPendingLocale();
  });
  let unwatch: (() => void) | null = null;
  const unsubscribe = deps.subscribeSyncClient((client) => {
    unwatch?.();
    unwatch = client ? retryLocaleOnReconnect(client) : null;
  });
  return () => {
    sub.remove();
    unsubscribe();
    unwatch?.();
    unwatch = null;
  };
}

/** What /me and the saved choice add up to; decided without side effects. */
export interface LocaleDecision {
  locale: Locale;
  /** Follow-up to run once the session is set (no await needed). */
  then: 'store' | 'resend' | 'confirm';
}

/**
 * Decide the language once /me answered. An unconfirmed local choice wins over the
 * server's value and is sent again; otherwise the server's value wins (a change
 * made on another device) and is stored for the next cold start.
 *
 * Only reads: the caller sets the session with the decided language, so the first
 * render already has it, and then runs applyLocaleDecision without awaiting it.
 */
export async function decideLocale(serverUser: User): Promise<LocaleDecision> {
  const [stored, pending] = await Promise.all([
    sqliteKV.getItem(SETTINGS.locale),
    sqliteKV.getItem(SETTINGS.localePending),
  ]);
  if (pending === '1' && (stored === 'de' || stored === 'en')) {
    return stored !== serverUser.locale
      ? { locale: stored, then: 'resend' }
      : { locale: stored, then: 'confirm' };
  }
  return { locale: serverUser.locale, then: 'store' };
}

/** Run the follow-up of a decision after setSession. Synchronous: nothing to wait for. */
export function applyLocaleDecision(d: LocaleDecision): void {
  if (d.then === 'resend') pushLocale(d.locale);
  else if (d.then === 'confirm') void sqliteKV.removeItem(SETTINGS.localePending);
  else void sqliteKV.setItem(SETTINGS.locale, d.locale);
}
