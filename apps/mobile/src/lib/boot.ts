import { pickMembership, type Locale, type Theme, type User, type Workspace } from '@balu/domain';
import { ApiError, type ApiClient } from '@balu/api-client';
import type { AccessLost } from '@balu/sync-client';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { makeT } from '../i18n';
import { useApp } from '../store/app';
import {
  claimAccessLossNotice,
  clearWorkspaceLossNotice,
  getApi,
  getSync,
  initApi,
  initSync,
  listKnownWorkspaceIds,
  purgeWorkspaceStorage,
  setAccessLostHandler,
  setSessionExpiredHandler,
  teardownSync,
  teardownSyncSettled,
} from './clients';
import { applyLocaleDecision, decideLocale } from './localeChoice';
import { SETTINGS, purgeUserData, sqliteKV } from './kv';
import { isForeignLocalData } from './localData';
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

/** /me answered with no workspace at all (an account the old server left workspace-less). */
export class NoWorkspaceError extends Error {
  constructor() {
    super('no workspace');
  }
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
  /**
   * Checked after every await and before anything is mutated; false abandons the
   * session change (returns false). Lets a caller drop a stale /me answer.
   */
  stillWanted: () => boolean = () => true,
): Promise<boolean> {
  const me = await api.getMe();
  // Another account's data is on this device (its session expired and was kept
  // for it): wipe it before anything reads it. The new tokens are already stored.
  if (isForeignLocalData(await sqliteKV.getItem(SETTINGS.session), me.user.id)) {
    stopReminderScheduler();
    // Closed and settled, not just stopped: a flush still running would write the
    // old user's queue and replica back after the purge (SQLite writes are async).
    await teardownSyncSettled();
    await purgeUserData({ keepAuth: true });
  }
  // Same rule as the web app (I8): explicit → last used → first. Taking
  // memberships[0] unconditionally threw a multi-workspace user back into the
  // same workspace on every launch.
  const lastUsed = await sqliteKV.getItem(SETTINGS.lastWorkspaceId);
  const membership = pickMembership(me.memberships, preferredWorkspaceId, lastUsed);
  // Boot and landing outside a lost workspace only: a switch has its own "exact or
  // nothing" answer. The server sets such an account up inside /me, so an empty list
  // means it could not; the callers say so and keep asking with a backoff.
  if (!membership && me.memberships.length === 0 && !requireExact) throw new NoWorkspaceError();
  if (!membership) return false;
  // Bail out before any mutation. pickMembership falls back to last-used/first
  // when the requested workspace vanished from /me (membership revoked while the
  // app was open); for a switch that fallback is a different workspace than the
  // user asked for, and mutating first would leave them in it with only an error
  // alert to show for it. Returning here keeps the live session fully intact.
  if (requireExact && membership.workspace.id !== preferredWorkspaceId) return false;
  // Read the cached name of the last-used workspace before setSession overwrites
  // the cache: if it is missing from /me, the alert can name it.
  const lastUsedName = lastUsed ? await cachedWorkspaceName(lastUsed) : null;
  // Decided before the last stillWanted check so that nothing awaits between
  // setSession and initSync: the store never shows a workspace the sync client
  // has not been switched to, and a logout cannot slip in between.
  const localeDecision = await decideLocale(me.user);
  if (!stillWanted()) return false;
  useApp.getState().setSession({ ...me.user, locale: localeDecision.locale }, me.memberships, membership.workspace);
  applyLocaleDecision(localeDecision);
  initSync(serverUrl, membership.workspace.id, me.user.id);
  void resumeReminders();
  void discardLostWorkspaces(
    me.memberships.map((m) => m.workspace.id),
    lastUsed,
    lastUsedName,
  );
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

/**
 * Every workspace this device holds local data for that /me no longer lists was
 * revoked or deleted while the app was closed. Discard its data and say how much
 * was lost - once, in one alert, however many workspaces it was.
 */
export async function discardLostWorkspaces(
  liveIds: string[],
  lastUsed: string | null = null,
  lastUsedName: string | null = null,
): Promise<void> {
  const live = new Set(liveIds);
  const candidates = new Set(await listKnownWorkspaceIds());
  // Installs from before the known-workspaces list only have the last-used id.
  if (lastUsed) candidates.add(lastUsed);
  const t = makeT(useApp.getState().locale);
  const bodies: string[] = [];
  let title = '';
  for (const id of candidates) {
    if (live.has(id)) {
      // Reachable again (re-invited before this boot): a notice an interrupted purge
      // left for it would never be shown and would inflate a later loss.
      await clearWorkspaceLossNotice(id);
      continue;
    }
    const { discarded, reason } = await purgeWorkspaceStorage(id);
    if (discarded === 0 || !claimAccessLossNotice(id)) continue;
    const notice = accessLostNotice(t, reason, discarded, id === lastUsed ? lastUsedName : null);
    title = notice.title;
    bodies.push(notice.body);
  }
  if (bodies.length > 0) Alert.alert(title, bodies.join('\n\n'));
}

/** Whether `workspaceId` is the workspace the app currently has open. */
function isOpen(workspaceId: string): boolean {
  return useApp.getState().workspace?.id === workspaceId;
}

/** The sync client lost access to a workspace (403/404): tell the user, move on. */
export async function handleAccessLost(info: AccessLost): Promise<void> {
  const st = useApp.getState();
  // An expected loss (delete, leave) only suppresses the notice; the app still
  // has to leave the workspace if the caller's own flow did not get that far.
  if (claimAccessLossNotice(info.workspaceId)) {
    const name =
      st.memberships.find((m) => m.workspace.id === info.workspaceId)?.workspace.name ??
      (st.workspace?.id === info.workspaceId ? st.workspace.name : null);
    const notice = accessLostNotice(makeT(st.locale), info.reason, info.discarded, name);
    Alert.alert(notice.title, notice.body);
  }
  // A client the app already replaced (switch) reports too; only the open one moves.
  if (!isOpen(info.workspaceId)) return;
  await moveOffLostWorkspace(info.workspaceId);
}

const moving = new Map<string, Promise<void>>();

/**
 * Leave a workspace the user can no longer reach (revoked, deleted): land in
 * another one from /me and delete the lost one's local data. The server never
 * leaves an account workspace-less (§2, §7), so /me always has a survivor.
 * Concurrent calls for one workspace share one move.
 */
export function moveOffLostWorkspace(lostId: string): Promise<void> {
  const running = moving.get(lostId);
  if (running) return running;
  const run = (async () => {
    await landOutside(lostId);
    await purgeWorkspaceStorage(lostId);
  })().finally(() => moving.delete(lostId));
  moving.set(lostId, run);
  return run;
}

/** Wait before retry `attempt` (0-based): 1 s, doubling, capped at 30 s, with +-20% jitter. */
function retryWaitMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 30_000) * (0.8 + Math.random() * 0.4);
}

/**
 * Take the stale screen down and say why: the open workspace is lost (or the
 * account has none) and /me cannot settle it yet. The sync client is torn down and
 * the sheets closed - their edits could only be dropped - and BootNotice covers the
 * rest with a logout button.
 */
function showBootNotice(state: 'reconnecting' | 'noWorkspace'): void {
  teardownSync();
  const st = useApp.getState();
  st.closeQuickAdd();
  st.closeDetail();
  st.closeSchedule();
  st.closeProjectActions();
  st.setBoot(state);
}

/**
 * Take every pushed screen down and land on the login step. The only caller is the
 * root layout's redirect effect (leaveForOnboarding): every path that ends in boot
 * 'onboarding' just sets the state, and that effect (past the gate) or the index
 * gate (cold start) does the navigating, so exactly one navigation happens.
 */
export function navigateToOnboarding(): void {
  try {
    if (router.canDismiss()) router.dismissAll();
    router.replace('/onboarding');
  } catch {
    /* router not ready */
  }
}

/**
 * /me answered with no workspace: show the notice and keep asking with a backoff
 * until it lists one, the user logs out, or the session is refused. Runs on its
 * own so the caller (and the splash screen) does not wait for it.
 */
function holdForWorkspace(serverUrl: string, api: ApiClient): void {
  showBootNotice('noWorkspace');
  void (async () => {
    const waiting = (): boolean => useApp.getState().boot === 'noWorkspace';
    for (let attempt = 0; waiting(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, retryWaitMs(attempt)));
      if (!waiting()) return;
      try {
        if (!(await establishSession(serverUrl, api, null, false, waiting))) {
          if (waiting()) useApp.getState().setBoot('onboarding'); // the root layout's effect leaves the screen
        }
        return;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401 && e.code !== 'signed_out') {
          await expireSession();
          return;
        }
        if (e instanceof ApiError && e.code === 'signed_out') return;
        // Still no workspace, or the server is unreachable: keep asking.
      }
    }
  })();
}

async function landOutside(lostId: string): Promise<void> {
  const { serverUrl } = useApp.getState();
  const api = getApi();
  let ok = false;
  if (serverUrl && api) {
    // No preferred id: the remembered last-used id is the lost one and /me no
    // longer lists it, so pickMembership lands in the first survivor.
    for (let attempt = 0; !ok && isOpen(lostId); attempt++) {
      try {
        ok = await establishSession(serverUrl, api, null, false, () => isOpen(lostId));
      } catch (e) {
        if (e instanceof NoWorkspaceError) {
          // /me answered and lists nothing: not a blip. Explain and keep asking.
          holdForWorkspace(serverUrl, api);
          return;
        }
        ok = false;
      }
      if (ok || !isOpen(lostId)) break;
      if (attempt < 1) continue; // one immediate second try, as before
      const { user, memberships } = useApp.getState();
      const survivors = memberships.filter((m) => m.workspace.id !== lostId);
      if (user && survivors[0]) {
        useApp.getState().setSession(user, survivors, survivors[0].workspace);
        initSync(serverUrl, survivors[0].workspace.id, user.id);
        ok = true;
        break;
      }
      // /me keeps failing and the store knows no other workspace (offline boot from
      // the cached session): the user is still signed in, so dropping them on the
      // login step would be wrong. Say so (the lost workspace's screen would only
      // drop edits) and keep asking with backoff until /me answers or they leave
      // (logout, expiry).
      if (attempt === 1) showBootNotice('reconnecting');
      await new Promise((resolve) => setTimeout(resolve, retryWaitMs(attempt - 1)));
    }
    // The user switched workspace (or left) while /me was in flight: keep their choice.
    if (!ok && !isOpen(lostId)) return;
  }
  if (!ok) {
    teardownSync();
    useApp.getState().setBoot('onboarding'); // the root layout's effect (or the index gate) navigates
  } else {
    resetToWorkspaceRoot();
  }
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
  } catch (e) {
    if (e instanceof NoWorkspaceError) {
      // Signed in, but /me lists no workspace and the server could not set one up:
      // say so, keep asking with a backoff and offer the logout, instead of showing
      // the login step with no explanation.
      holdForWorkspace(serverUrl, api);
      return;
    }
    // A refused session is not "offline": booting the cached session would keep
    // an account running whose tokens are gone.
    if (e instanceof ApiError && e.status === 401 && e.code !== 'signed_out') {
      await expireSession();
      return;
    }
    // Logged out while /me was in flight: do not revive the session from the cache.
    if (e instanceof ApiError && e.code === 'signed_out') {
      store.setBoot('onboarding');
      return;
    }
    // Offline (or server down): boot from the cached session so the local
    // replica + queue still work (acceptance criterion 2).
    if (sessionRaw) {
      try {
        const cached = JSON.parse(sessionRaw) as { user: User; workspace: Workspace };
        store.setSession(cached.user, [], cached.workspace);
        // Covers sessions cached before setLocale kept the cache in step: those carry
        // the language of the last /me, not the user's latest choice.
        if (localeRaw === 'de' || localeRaw === 'en') store.setLocale(localeRaw as Locale);
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

/**
 * The server refused the refresh token (or /me answered 401): back to the
 * login step with a notice. Queue and replica stay - they sync once the same
 * user signs in again; establishSession wipes them if someone else does.
 */
export async function expireSession(): Promise<void> {
  stopReminderScheduler();
  teardownSync();
  await getApi()?.logout().catch(() => {}); // no network call once the refresh token is gone
  const st = useApp.getState();
  // Only the state changes here: the root layout's effect leaves a screen of the app,
  // the index gate handles the cold start.
  st.reset();
  st.setLoginNotice('sessionExpired');
}

setSessionExpiredHandler(() => {
  void expireSession();
});

/**
 * Log out everywhere: stop syncing, revoke server-side, wipe local user data,
 * and end the session. Leaving for onboarding is the root layout's effect (it
 * clears the stack for every caller: Settings logout, change server, BootNotice), so
 * a bare replace can not leave Today underneath for the Android back button.
 */
export async function logout(): Promise<void> {
  let revoked: Promise<void> = Promise.resolve();
  try {
    // Close first and wait for storage writes already started, so nothing re-persists after the purge.
    stopReminderScheduler();
    await teardownSyncSettled();

    // Started, not awaited: the request can take its whole timeout in an outage,
    // and an app killed meanwhile must not come back signed in with all its data.
    // api.logout() drops the stored tokens before it posts, and the revoke never
    // needs local state, so the purge does not wait for it.
    const api = getApi();
    revoked = (async () => {
      try {
        await api?.logout();
      } catch {
        /* best-effort */
      }
    })();
    await purgeUserData();
  } finally {
    // A failing purge must still end the session in the UI and leave the screen.
    // The root layout's effect sees boot 'onboarding' and clears the stack.
    useApp.getState().reset();
  }
  await revoked;
}
