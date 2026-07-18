import type { Locale, Theme, User, Workspace } from '@balu/domain';
import type { ApiClient } from '@balu/api-client';
import { useApp } from '../store/app';
import { getApi, initApi, initSync } from './clients';
import { SETTINGS, sqliteKV } from './kv';

/** Fetch /me, pick the boot workspace, wire up the sync client. */
export async function establishSession(serverUrl: string, api: ApiClient): Promise<boolean> {
  const me = await api.getMe();
  const membership = me.memberships[0];
  if (!membership) return false;
  useApp.getState().setSession(me.user, me.memberships, membership.workspace);
  initSync(serverUrl, membership.workspace.id, me.user.id);
  return true;
}

/** Boot the app: load settings, hydrate tokens, resume or fall back to login. */
export async function bootApp(): Promise<void> {
  const store = useApp.getState();

  const [serverUrl, themeRaw, localeRaw, sessionRaw] = await Promise.all([
    sqliteKV.getItem(SETTINGS.serverUrl),
    sqliteKV.getItem(SETTINGS.theme),
    sqliteKV.getItem(SETTINGS.locale),
    sqliteKV.getItem(SETTINGS.session),
  ]);

  if (themeRaw === 'light' || themeRaw === 'dark' || themeRaw === 'system') {
    store.setTheme(themeRaw as Theme);
  }
  if (localeRaw === 'de' || localeRaw === 'en') {
    store.setLocale(localeRaw as Locale);
  }

  if (!serverUrl) {
    store.setBoot('onboarding');
    return;
  }
  store.setServerUrl(serverUrl);

  const api = initApi(serverUrl);
  await api.hydrate();

  if (!api.isAuthenticated()) {
    store.setBoot('onboarding');
    return;
  }

  try {
    const ok = await establishSession(serverUrl, api);
    if (!ok) store.setBoot('onboarding');
  } catch {
    // Offline (or server down): boot from the cached session so the local
    // replica + queue still work (acceptance criterion 2).
    if (sessionRaw) {
      try {
        const cached = JSON.parse(sessionRaw) as { user: User; workspace: Workspace };
        store.setSession(cached.user, [], cached.workspace);
        initSync(serverUrl, cached.workspace.id, cached.user.id);
        return;
      } catch {
        /* corrupt cache — fall through */
      }
    }
    store.setBoot('onboarding');
  }
}

/** Log out everywhere: clear tokens + cached session, tear down, back to login. */
export async function logout(): Promise<void> {
  const api = getApi();
  try {
    await api?.logout();
  } catch {
    /* best-effort */
  }
  await sqliteKV.removeItem(SETTINGS.session);
  const { teardownSync } = await import('./clients');
  teardownSync();
  useApp.getState().reset();
}
