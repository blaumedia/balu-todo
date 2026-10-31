import { pickMembership, type Locale, type Theme, type User, type Workspace } from '@balu/domain';
import type { ApiClient } from '@balu/api-client';
import type { AccessLost } from '@balu/sync-client';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { makeT } from '../i18n';
import { useApp } from '../store/app';
import {
  claimAccessLossNotice,
  getApi,
  getSync,
  initApi,
  initSync,
  isAccessLossExpected,
  purgeWorkspaceStorage,
  setAccessLostHandler,
  teardownSync,
} from './clients';
import { SETTINGS, purgeUserData, sqliteKV } from './kv';
import { getReminderPermissionGranted, startReminderScheduler, stopReminderScheduler } from './notifications';
import { accessLostNotice } from './syncNotices';

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
  // Last-used workspace missing from /me: revoked or deleted while the app was
  // closed. Read its cached name before setSession overwrites the cache.
  const lostLastUsed =
    lastUsed && !me.memberships.some((m) => m.workspace.id === lastUsed) ? lastUsed : null;
  const lostName = lostLastUsed ? await cachedWorkspaceName(lostLastUsed) : null;
  useApp.getState().setSession(me.user, me.memberships, membership.workspace);
  initSync(serverUrl, membership.workspace.id, me.user.id);
  void resumeReminders();
  if (lostLastUsed) void discardLostWorkspace(lostLastUsed, lostName);
  return true;
}

async function cachedWorkspaceName(id: string): Promise<string | null> {
  try {
    const raw = await sqliteKV.getItem(SETTINGS.session);
    const cached = raw ? (JSON.parse(raw) as { workspace?: Workspace }) : null;
    return cached?.workspace?.id === id ? cached.workspace.name : null;
  } catch {
    return null;
  }
}

async function discardLostWorkspace(workspaceId: string, name: string | null): Promise<void> {
  const discarded = await purgeWorkspaceStorage(workspaceId);
  if (discarded === 0 || !claimAccessLossNotice(workspaceId)) return;
  const notice = accessLostNotice(makeT(useApp.getState().locale), 'removed', discarded, name);
  Alert.alert(notice.title, notice.body);
}

/** The sync client lost access to a workspace (403/404): tell the user, move on. */
export async function handleAccessLost(info: AccessLost): Promise<void> {
  if (isAccessLossExpected(info.workspaceId)) return;
  const st = useApp.getState();
  if (claimAccessLossNotice(info.workspaceId)) {
    const name =
      st.memberships.find((m) => m.workspace.id === info.workspaceId)?.workspace.name ??
      (st.workspace?.id === info.workspaceId ? st.workspace.name : null);
    const notice = accessLostNotice(makeT(st.locale), info.reason, info.discarded, name);
    Alert.alert(notice.title, notice.body);
  }
  // A client the app already replaced (switch) reports too; only the open one moves.
  if (useApp.getState().workspace?.id !== info.workspaceId) return;
  await moveOffLostWorkspace(info.workspaceId);
}

/**
 * Leave a workspace the user can no longer reach (revoked, deleted): land in
 * another one from /me and delete the lost one's local data. The server never
 * leaves an account workspace-less (§2, §7), so /me always has a survivor.
 */
export async function moveOffLostWorkspace(lostId: string): Promise<void> {
  const { serverUrl } = useApp.getState();
  const api = getApi();
  let ok = false;
  if (serverUrl && api) {
    // No preferred id: the remembered last-used id is the lost one and /me no
    // longer lists it, so pickMembership lands in the first survivor.
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        ok = await establishSession(serverUrl, api);
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      const { user, memberships } = useApp.getState();
      const survivors = memberships.filter((m) => m.workspace.id !== lostId);
      if (user && survivors[0]) {
        useApp.getState().setSession(user, survivors, survivors[0].workspace);
        initSync(serverUrl, survivors[0].workspace.id, user.id);
        ok = true;
      }
    }
  }
  if (!ok) {
    teardownSync();
    useApp.getState().setBoot('onboarding');
  } else {
    resetToWorkspaceRoot();
  }
  await purgeWorkspaceStorage(lostId);
}

/** Everything on screen belongs to the lost workspace (same hygiene as settings doSwitch). */
function resetToWorkspaceRoot(): void {
  const st = useApp.getState();
  st.setContext({ kind: 'list', list: 'today' });
  st.closeQuickAdd();
  st.closeDetail();
  st.closeSchedule();
  st.closeProjectActions();
  try {
    if (router.canDismiss()) router.dismissAll();
  } catch {
    /* router not ready */
  }
}

setAccessLostHandler((info) => {
  void handleAccessLost(info);
});

/** Switch to another workspace of the signed-in user. Returns false if the
 *  prerequisites are missing; throws when the server is unreachable. */
export async function switchWorkspace(workspaceId: string): Promise<boolean> {
  const { serverUrl } = useApp.getState();
  const api = getApi();
  if (!serverUrl || !api) return false;
  // initSync stops the old client, and stop() cancels its debounced flush, so
  // nudge the outgoing queue out now. Deliberately not awaited: the sync POST
  // times out after 30 s (sync-client `requestTimeoutMs`), and awaiting it would
  // still stall the switch for that long. Nothing can be lost or misrouted either
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
