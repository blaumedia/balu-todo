import { pickMembership, type Locale, type Theme, type User, type Workspace } from '@balu/domain';
import type { ApiClient } from '@balu/api-client';
import { useApp } from '../store/app';
import { getApi, getSync, initApi, initSync } from './clients';
import { SETTINGS, purgeUserData, sqliteKV } from './kv';
import { getReminderPermissionGranted, startReminderScheduler, stopReminderScheduler } from './notifications';

/**
 * Start the local reminder scheduler if the user opted in and the OS still
 * grants permission; otherwise reconcile the preference back to off (permission
 * may have been revoked in system settings since last launch).
 */
async function resumeReminders(): Promise<void> {
  if (!useApp.getState().remindersEnabled) return;
  if (await getReminderPermissionGranted()) startReminderScheduler();
  else useApp.getState().setRemindersEnabled(false);
}

/** Fetch /me, pick the boot workspace, wire up the sync client. */
export async function establishSession(
  serverUrl: string,
  api: ApiClient,
  preferredWorkspaceId?: string | null,
  /**
   * Explicit switch: land in `preferredWorkspaceId` or nowhere. Boot leaves this
   * off because falling back is exactly what it wants.
   */
  requireExact = false,
): Promise<boolean> {
  const me = await api.getMe();
  // Same rule as the web app (I8): explicit → last used → first. Taking
  // memberships[0] unconditionally threw a multi-workspace user back into the
  // same workspace on every launch.
  const lastUsed = await sqliteKV.getItem(SETTINGS.lastWorkspaceId);
  const membership = pickMembership(me.memberships, preferredWorkspaceId, lastUsed);
  if (!membership) return false;
  // Bail out before any mutation. pickMembership falls back to last-used/first
  // when the requested workspace vanished from /me (membership revoked while the
  // app was open); for a switch that fallback is a different workspace than the
  // user asked for, and mutating first would leave them in it with only an error
  // alert to show for it. Returning here keeps the live session fully intact.
  if (requireExact && membership.workspace.id !== preferredWorkspaceId) return false;
  useApp.getState().setSession(me.user, me.memberships, membership.workspace);
  initSync(serverUrl, membership.workspace.id, me.user.id);
  void resumeReminders();
  return true;
}

/** Switch to another workspace of the signed-in user. Returns false if the
 *  prerequisites are missing; throws when the server is unreachable. */
export async function switchWorkspace(workspaceId: string): Promise<boolean> {
  const { serverUrl } = useApp.getState();
  const api = getApi();
  if (!serverUrl || !api) return false;
  // initSync stops the old client, and stop() cancels its debounced flush, so
  // nudge the outgoing queue out now. Deliberately not awaited: the sync POST
  // has no timeout, so on a black-hole network the await would stall the switch
  // for the platform's socket timeout. Nothing can be lost or misrouted either
  // way - the queue is persisted under the old workspace's key and the in-flight
  // request keeps writing there.
  void getSync()?.flush().catch(() => {});
  // `requireExact`: a revoked membership must fail the switch without touching
  // the session, not silently drop the user into another workspace.
  return establishSession(serverUrl, api, workspaceId, true);
}

/** Boot the app: load settings, hydrate tokens, resume or fall back to login. */
export async function bootApp(): Promise<void> {
  const store = useApp.getState();

  const [serverUrl, themeRaw, localeRaw, remindersRaw, sessionRaw] = await Promise.all([
    sqliteKV.getItem(SETTINGS.serverUrl),
    sqliteKV.getItem(SETTINGS.theme),
    sqliteKV.getItem(SETTINGS.locale),
    sqliteKV.getItem(SETTINGS.remindersEnabled),
    sqliteKV.getItem(SETTINGS.session),
  ]);

  if (themeRaw === 'light' || themeRaw === 'dark' || themeRaw === 'system') {
    store.setTheme(themeRaw as Theme);
  }
  if (localeRaw === 'de' || localeRaw === 'en') {
    store.setLocale(localeRaw as Locale);
  }
  if (remindersRaw === '1') {
    store.setRemindersEnabled(true);
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
        void resumeReminders();
        return;
      } catch {
        /* corrupt cache — fall through */
      }
    }
    store.setBoot('onboarding');
  }
}

/** Log out everywhere: stop syncing, revoke server-side, wipe local user data. */
export async function logout(): Promise<void> {
  // Tear down first so nothing re-persists after the purge.
  stopReminderScheduler();
  const { teardownSync } = await import('./clients');
  teardownSync();

  const api = getApi();
  try {
    await api?.logout();
  } catch {
    /* best-effort */
  }
  await purgeUserData();
  useApp.getState().reset();
}
