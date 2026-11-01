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
async function resumeReminders(ends: number): Promise<void> {
  if (!useApp.getState().remindersEnabled) return;
  const granted = await getReminderPermissionGranted();
  // A logout or expiry during the permission read has stopped the scheduler; starting
  // it now would undo that (reset() keeps remindersEnabled).
  if (ends !== sessionEnds) return;
  if (granted) startReminderScheduler();
  else useApp.getState().setRemindersEnabled(false);
}

/** /me answered with no workspace at all (an account the old server left workspace-less). */
export class NoWorkspaceError extends Error {
  constructor() {
    super('no workspace');
  }
}

/**
 * Session epoch. Bumped synchronously at the very start of logout() and
 * expireSession() and right before every setSession in this module (a new
 * session). Every async recovery (the /me in establishSession, landAfterDelete,
 * landOutside, the holdForWorkspace loop) captures it when it starts and drops
 * its result once it differs, so a logout that is still running (it awaits the
 * sync teardown while the tokens and the store still look live) can never be
 * overtaken by a late /me, and a loop of an older session never blocks or
 * outlives into a newer one.
 */
let sessionEpoch = 0;

/**
 * Number of sessions ended (logout, expiry). Work started after a setSession
 * without being awaited (reminders, the lost-workspace alert) captures it and
 * drops its effect once a session ended meanwhile. Not the epoch: a later new
 * session must not suppress the alert of an earlier one that is still running.
 */
let sessionEnds = 0;

/**
 * Logouts that are running. A logout bumps the epoch and then awaits the sync
 * teardown while the tokens and the store still look live, so a flow that
 * *starts* in that window captures the new epoch and would get its /me through
 * and start a sync client the purge never closes. While this is above zero no
 * flow may create or switch a session.
 */
let endingSession = 0;

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
  const epoch = sessionEpoch;
  const wanted = (): boolean => endingSession === 0 && epoch === sessionEpoch && stillWanted();
  const me = await api.getMe();
  if (!wanted()) return false;
  const cachedSession = await sqliteKV.getItem(SETTINGS.session);
  // Checked before the teardown below: a stale answer must not close the sync
  // client of the session that overtook it.
  if (!wanted()) return false;
  // Another account's data is on this device (its session expired and was kept
  // for it): wipe it before anything reads it. The new tokens are already stored.
  if (isForeignLocalData(cachedSession, me.user.id)) {
    stopReminderScheduler();
    // Closed and settled, not just stopped: a flush still running would write the
    // old user's queue and replica back after the purge (SQLite writes are async).
    await teardownSyncSettled();
    if (!wanted()) return false;
    await purgeUserData({ keepAuth: true });
  }
  // Same rule as the web app (I8): explicit → last used → first. Taking
  // memberships[0] unconditionally threw a multi-workspace user back into the
  // same workspace on every launch.
  const lastUsed = await sqliteKV.getItem(SETTINGS.lastWorkspaceId);
  if (!wanted()) return false;
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
  if (!wanted()) return false;
  sessionEpoch++;
  useApp.getState().setSession({ ...me.user, locale: localeDecision.locale }, me.memberships, membership.workspace);
  applyLocaleDecision(localeDecision);
  initSync(serverUrl, membership.workspace.id, me.user.id);
  void resumeReminders(sessionEnds);
  void discardLostWorkspaces(
    me.memberships.map((m) => m.workspace.id),
    lastUsed,
    lastUsedName,
    sessionEnds,
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
  /** The `sessionEnds` of the session that started this; the alert is dropped once one ended since. */
  ends: number = sessionEnds,
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
  if (bodies.length > 0 && ends === sessionEnds) Alert.alert(title, bodies.join('\n\n'));
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

interface Move {
  epoch: number;
  promise: Promise<void>;
}

const moving = new Map<string, Move>();

/**
 * Leave a workspace the user can no longer reach (revoked, deleted): land in
 * another one from /me and delete the lost one's local data. The server never
 * leaves an account workspace-less (§2, §7), so /me always has a survivor.
 * Concurrent calls for one workspace in one session epoch share one move: a move
 * of an older session (still in its backoff after a logout) ends at its next check
 * without landing, so a loss in the new session must not join it.
 */
export function moveOffLostWorkspace(lostId: string): Promise<void> {
  const epoch = sessionEpoch;
  const running = moving.get(lostId);
  if (running && running.epoch === epoch) return running.promise;
  const me: Move = { epoch, promise: Promise.resolve() };
  me.promise = (async () => {
    await landOutside(lostId);
    await purgeWorkspaceStorage(lostId);
  })().finally(() => {
    if (moving.get(lostId) === me) moving.delete(lostId);
  });
  moving.set(lostId, me);
  return me.promise;
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
 * `canDismiss` is read by the caller from the live navigation state (canDismissState):
 * `router.canDismiss()` reads a router store that can lag behind it and answered
 * false with a screen pushed, which left a hidden `(tabs)` below onboarding.
 */
export function navigateToOnboarding(canDismiss: boolean): void {
  try {
    if (canDismiss) router.dismissAll();
    router.replace('/onboarding');
  } catch {
    /* router not ready */
  }
}

/**
 * Last resort after the workspace `goneId` was deleted and /me stays unreachable:
 * switch locally to a workspace the store already knows. Reads the store now, not
 * a copy taken when the caller rendered. Guards on the token state as well as on
 * boot/user: the api-client clears its tokens synchronously before it reports an
 * expired session, while expireSession only resets the store after awaiting the
 * logout request, so boot and user can still look live in that window and
 * setSession would revive 'ready' (and start a sync client) with no tokens.
 * Returns why nothing was opened, or 'opened'. 'left' means the session is no
 * longer 'ready' (expired, logged out, or a notice such as 'reconnecting' is up);
 * 'moved' means it is no longer on `goneId` (another flow has already taken the
 * session elsewhere). Mutates nothing unless it returns 'opened'.
 */
export function fallBackToKnownWorkspace(
  serverUrl: string,
  goneId: string,
): 'opened' | 'moved' | 'left' | 'none' {
  const st = useApp.getState();
  if (endingSession > 0 || st.boot !== 'ready' || !st.user || !getApi()?.isAuthenticated()) return 'left';
  if (st.workspace?.id !== goneId) return 'moved';
  const survivors = st.memberships.filter((m) => m.workspace.id !== goneId);
  if (!survivors[0]) return 'none';
  sessionEpoch++;
  st.setSession(st.user, survivors, survivors[0].workspace);
  initSync(serverUrl, survivors[0].workspace.id, st.user.id);
  return 'opened';
}

/**
 * Land somewhere after the open workspace `goneId` was deleted by this user: two
 * tries at /me, then the locally known fallback. A /me answer is dropped unless
 * `goneId` is still open, the tokens are alive and the session epoch is the one
 * this call started in (a logout, expiry or a concurrent recovery during the
 * request must not be undone; landOutside guards on the open workspace and the
 * epoch only). A 401 ends the session through expireSession and the attempt
 * without a second request, and an empty /me goes to holdForWorkspace (one loop
 * per epoch: a concurrent landOutside joins it).
 * It is not folded into landOutside because that one keeps asking with a backoff
 * while the server is unreachable, and the settings screen awaits this call.
 * 'held': /me lists no workspace, so the caller must not fall back to a stale
 * survivor. 'left': the session is no longer 'ready' (a 401 ended it, or a logout
 * or a notice already explains it). 'failed': the workspace is deleted but /me
 * and the known workspaces gave nowhere to land.
 */
export async function landAfterDelete(
  serverUrl: string,
  api: ApiClient,
  goneId: string,
): Promise<'landed' | 'held' | 'left' | 'failed'> {
  const epoch = sessionEpoch;
  const wanted = (): boolean =>
    endingSession === 0 && epoch === sessionEpoch && isOpen(goneId) && !!getApi()?.isAuthenticated();
  // Only reached when !wanted(). 'landed' when the session is live and no longer on
  // `goneId`: another flow (an access-loss recovery, a switch) landed it, and that
  // always bumped the epoch, so the epoch is deliberately not compared here. Reads
  // only; it never opens anything itself.
  const settled = (): 'landed' | 'left' => {
    const st = useApp.getState();
    const live = endingSession === 0 && st.boot === 'ready' && !!st.user && !!getApi()?.isAuthenticated();
    return live && st.workspace?.id !== goneId ? 'landed' : 'left';
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!wanted()) return settled();
    try {
      if (await establishSession(serverUrl, api, null, false, wanted)) return 'landed';
    } catch (e) {
      if (e instanceof NoWorkspaceError) {
        if (!wanted()) return settled();
        void holdForWorkspace(serverUrl, api);
        return 'held';
      }
      // Refused or logged out: a second /me would carry no token. A 401 that left
      // the tokens in place (refresh worked, the retry still answered 401) has not
      // ended the session yet: do it here, as bootApp does. A refused refresh
      // already fired the expiry handler (tokens gone, so not authenticated).
      if (e instanceof ApiError && e.status === 401) {
        if (e.code !== 'signed_out' && endingSession === 0 && epoch === sessionEpoch && getApi()?.isAuthenticated()) {
          await expireSession();
        }
        return 'left';
      }
    }
  }
  if (!wanted()) return settled();
  const r = fallBackToKnownWorkspace(serverUrl, goneId);
  if (r === 'opened' || r === 'moved') return 'landed';
  return r === 'left' ? 'left' : 'failed';
}

/**
 * How a hold ended: 'landed' when this very hold's establishSession set the session,
 * 'left' for everything else (logout, expiry, superseded, refused, no workspace after all).
 */
export type HoldOutcome = 'landed' | 'left';

interface Hold {
  epoch: number;
  promise: Promise<HoldOutcome>;
}

let hold: Hold | null = null;

/** Test-only: forget every recovery of the previous test and end its loops. */
export function resetBootStateForTests(): void {
  sessionEpoch++;
  sessionEnds++;
  endingSession = 0;
  hold = null;
  moving.clear();
}

/**
 * /me answered with no workspace: show the notice and keep asking with a backoff
 * until it lists one, the user logs out, or the session is refused. Runs on its
 * own so the caller (and the splash screen) does not wait for it: callers that
 * must not block `void` the returned promise, which settles when the loop ends.
 * One loop per session epoch: a second trigger in the same epoch while the
 * notice is still up (a delete's landing and the old sync client's access-loss
 * recovery) leaves the running loop alone and gets its promise. If another
 * notice replaced it meanwhile ('reconnecting' ends the old loop), or the epoch
 * moved on (logout, a new session), a new loop starts and supersedes the old one.
 * The promise resolves with the HoldOutcome; joiners get the same one. The backoff
 * sleep wakes as soon as the hold is no longer waiting (logout from the notice), so
 * an awaiting caller is released at once.
 */
export function holdForWorkspace(serverUrl: string, api: ApiClient): Promise<HoldOutcome> {
  // A logout is running: no notice and no loop for a session that is going away.
  if (endingSession > 0) return Promise.resolve('left');
  const epoch = sessionEpoch;
  if (hold && hold.epoch === epoch && useApp.getState().boot === 'noWorkspace') return hold.promise;
  const me: Hold = { epoch, promise: Promise.resolve('left') };
  hold = me;
  me.promise = (async () => {
    try {
      showBootNotice('noWorkspace');
      const waiting = (): boolean => useApp.getState().boot === 'noWorkspace' && sessionEpoch === epoch && hold === me;
      for (let attempt = 0; waiting(); attempt++) {
        await new Promise<void>((resolve) => {
          const done = (): void => {
            clearTimeout(timer);
            unsubscribe();
            resolve();
          };
          const timer = setTimeout(done, retryWaitMs(attempt));
          // Wake early once the notice is gone (logout, expiry) or this hold is superseded.
          const unsubscribe = useApp.subscribe(() => {
            if (!waiting()) done();
          });
        });
        if (!waiting()) return 'left';
        try {
          if (await establishSession(serverUrl, api, null, false, waiting)) return 'landed';
          if (waiting()) useApp.getState().setBoot('onboarding'); // the root layout's effect leaves the screen
          return 'left';
        } catch (e) {
          if (e instanceof ApiError && e.status === 401 && e.code !== 'signed_out') {
            if (waiting()) await expireSession();
            return 'left';
          }
          if (e instanceof ApiError && e.code === 'signed_out') return 'left';
          // Still no workspace, or the server is unreachable: keep asking.
        }
      }
      return 'left';
    } finally {
      if (hold === me) hold = null;
    }
  })().catch((): HoldOutcome => {
    /* showBootNotice failed: resolve so an awaiting caller (onboarding) just continues */
    return 'left';
  });
  return me.promise;
}

async function landOutside(lostId: string): Promise<void> {
  const { serverUrl } = useApp.getState();
  const api = getApi();
  const epoch = sessionEpoch;
  const wanted = (): boolean => endingSession === 0 && epoch === sessionEpoch && isOpen(lostId);
  let ok = false;
  if (serverUrl && api) {
    // No preferred id: the remembered last-used id is the lost one and /me no
    // longer lists it, so pickMembership lands in the first survivor.
    for (let attempt = 0; !ok && wanted(); attempt++) {
      try {
        ok = await establishSession(serverUrl, api, null, false, wanted);
      } catch (e) {
        if (e instanceof NoWorkspaceError) {
          // /me answered and lists nothing: not a blip. Explain and keep asking.
          if (wanted()) void holdForWorkspace(serverUrl, api);
          return;
        }
        // A 401 that left the tokens in place (the refresh worked, the retry still
        // answered 401) is a refused session, not an outage: end it, as the other
        // flows do. A refused refresh already fired the expiry handler.
        if (e instanceof ApiError && e.status === 401) {
          if (e.code !== 'signed_out' && wanted() && getApi()?.isAuthenticated()) await expireSession();
          return;
        }
        ok = false;
      }
      if (ok || !wanted()) break;
      if (attempt < 1) continue; // one immediate second try, as before
      const { user, memberships } = useApp.getState();
      const survivors = memberships.filter((m) => m.workspace.id !== lostId);
      if (user && survivors[0]) {
        sessionEpoch++;
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
    if (!ok && !wanted()) return;
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
    // router.canDismiss() is safe here: this runs after network calls on a live
    // session, long after the store started following the navigation (onReady);
    // only the cold-start gate and onboarding redirect need the live state.
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
  if (!serverUrl || !api || endingSession > 0) return false;
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
  const epoch = sessionEpoch;

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
    // Not when the session moved on meanwhile (logout, expiry): that already set the state.
    if (!ok && epoch === sessionEpoch) store.setBoot('onboarding');
  } catch (e) {
    // A logout or expiry during /me has ended the session and set the state: do not
    // hold for it, expire it a second time or revive it from the cache.
    if (epoch !== sessionEpoch) return;
    if (e instanceof NoWorkspaceError) {
      // Signed in, but /me lists no workspace and the server could not set one up:
      // say so, keep asking with a backoff and offer the logout, instead of showing
      // the login step with no explanation.
      void holdForWorkspace(serverUrl, api);
      return;
    }
    // A refused session is not "offline": booting the cached session would keep
    // an account running whose tokens are gone.
    if (e instanceof ApiError && e.status === 401 && e.code !== 'signed_out') {
      // A refused refresh already fired the expiry handler (tokens gone).
      if (getApi()?.isAuthenticated()) await expireSession();
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
        sessionEpoch++;
        store.setSession(cached.user, [], cached.workspace);
        // Covers sessions cached before setLocale kept the cache in step: those carry
        // the language of the last /me, not the user's latest choice.
        if (localeRaw === 'de' || localeRaw === 'en') store.setLocale(localeRaw as Locale);
        initSync(serverUrl, cached.workspace.id, cached.user.id);
        void resumeReminders(sessionEnds);
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
  sessionEnds++;
  sessionEpoch++; // synchronously: recoveries in flight must not outlive the session
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
  // Before the first await: the teardown below runs while the tokens and the store
  // still look live, and a /me answering meanwhile must not start a new session.
  sessionEpoch++;
  sessionEnds++;
  endingSession++;
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
    // Decrement first: if reset() ever threw, a counter left above zero would make
    // every flow refuse until restart.
    endingSession--;
    // A failing purge must still end the session in the UI and leave the screen.
    // The root layout's effect sees boot 'onboarding' and clears the stack.
    useApp.getState().reset();
  }
  await revoked;
}
