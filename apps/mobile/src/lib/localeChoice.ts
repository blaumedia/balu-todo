import type { Locale, User } from '@balu/domain';
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

function pushLocale(locale: Locale): void {
  getApi()
    ?.patchMe({ locale })
    .then(() => {
      // A newer choice made while this request was in flight stays pending.
      if (useApp.getState().locale === locale) void sqliteKV.removeItem(SETTINGS.localePending);
    })
    .catch(() => {});
}

/**
 * Decide the language once /me answered. An unconfirmed local choice wins over the
 * server's value and is sent again; otherwise the server's value wins (a change
 * made on another device) and is stored for the next cold start.
 */
export async function reconcileLocale(serverUser: User): Promise<void> {
  const [stored, pending] = await Promise.all([
    sqliteKV.getItem(SETTINGS.locale),
    sqliteKV.getItem(SETTINGS.localePending),
  ]);
  const store = useApp.getState();
  if (pending === '1' && (stored === 'de' || stored === 'en')) {
    if (stored !== serverUser.locale) {
      store.setLocale(stored);
      pushLocale(stored);
    } else {
      void sqliteKV.removeItem(SETTINGS.localePending);
    }
    return;
  }
  store.setLocale(serverUser.locale);
}
