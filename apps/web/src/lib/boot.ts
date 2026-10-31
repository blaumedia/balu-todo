import { ACCESS_KEY, ApiError, REFRESH_KEY, tokenSubject } from "@balu/api-client";
import { pickMembership, type MeResponse } from "@balu/domain";
import type { AccessLost } from "@balu/sync-client";
import { makeT } from "../i18n/index.js";
import {
  api,
  claimAccessLossNotice,
  closeSync,
  getSyncWorkspaceId,
  initSync,
  listStoredWorkspaceIds,
  purgeWorkspaceStorage,
  setAccessLostHandler,
  setSessionEndedElsewhereHandler,
  setSessionExpiredHandler,
  teardownSync,
} from "./clients.js";
import { bootRetryDelayMs, waitForRetry } from "./bootRetry.js";
import { adoptLocalDataFor, OWNER_KEY, purgeLocalData } from "./localData.js";
import { accessLostMessage } from "./syncNotices.js";
import { lastWorkspaceId, useApp } from "../store/app.js";

/**
 * The server refused the refresh token, or /me answered 401: show the login
 * screen with a notice. Unsynced changes stay stored - they go out when the same
 * user signs in again, and are wiped by adoptLocalDataFor if someone else does.
 * Idempotent: the api-client hook and bootSession's 401 branch can both call it.
 */
export async function expireSession(wasReady = useApp.getState().boot === "ready"): Promise<void> {
  teardownSync();
  // Tokens are already cleared after a refused refresh; this removes a stale
  // access token left without a refresh token. No network call when the
  // refresh token is gone.
  await api.logout().catch(() => {});
  const st = useApp.getState();
  st.reset();
  st.setLoginNotice("sessionExpired");
  // As in logout(): the address bar must not keep ids of a session that ended.
  // Not during boot or the invite flow - /invite/:token must survive the login.
  if (wasReady) globalThis.history?.replaceState(null, "", "/");
}

setSessionExpiredHandler(() => {
  void expireSession();
});

/** False only when this browser can tell the stored login is gone. */
function loginStored(): boolean {
  const ls = globalThis.localStorage;
  return !ls || ls.getItem(REFRESH_KEY) !== null;
}

/**
 * This browser no longer holds a login. With the owner key still stored the
 * session merely expired (another tab's refresh was refused): same as an expiry
 * here - login screen with the notice, unsynced changes kept for the same user.
 * Without it the user logged out: purge, no notice.
 */
async function loginGone(wasReady?: boolean): Promise<void> {
  await api.hydrate();
  if (globalThis.localStorage?.getItem(OWNER_KEY)) {
    await expireSession(wasReady);
    return;
  }
  purgeLocalData();
  useApp.getState().reset();
  globalThis.history?.replaceState(null, "", "/");
}

/**
 * Another tab changed the stored login under this one (logged out, or a
 * different user signed in). Close the sync client for good so nothing of this
 * tab's user is ever written back (not even by a pull or flush already in
 * flight), and clear the screen at once. Then follow storage: no login left
 * means logout semantics (purge, no expiry notice) or, when the owner is still
 * stored (the session expired there), the expiry screen that keeps the data;
 * someone else's login means boot as that user from scratch - never carry this
 * tab's store, queue or workspace over.
 * Resolves true when the app booted as the user now stored.
 */
export async function reconcileSession(): Promise<boolean> {
  const wasReady = useApp.getState().boot === "ready";
  // Before the first await: the previous user's data must not stay on screen
  // while a request that cannot be cancelled winds down.
  useApp.getState().reset();
  useApp.getState().setBoot("loading");
  // Closed, not just stopped: the other tab's adopt/purge may already have run,
  // and a late write from this tab's client would land after it. Not awaited:
  // closed clients never write again and localStorage writes are synchronous.
  closeSync();
  await api.hydrate();
  if (!api.isAuthenticated()) {
    await loginGone(wasReady);
    return false;
  }
  return bootSession();
}

setSessionEndedElsewhereHandler(() => {
  void reconcileSession();
});

/**
 * Web storage event from another tab. Rotating tokens of the same user (a
 * refresh there) is normal and ignored; a login that is gone, or one of a
 * different user than this tab holds, is not.
 */
export function onStorageEvent(e: { key: string | null }): void {
  const st = useApp.getState();
  if (st.boot !== "ready" && st.boot !== "unreachable") return;
  const ls = globalThis.localStorage;
  if (!ls) return;
  if (e.key !== null && e.key !== REFRESH_KEY && e.key !== OWNER_KEY) return;
  if (ls.getItem(REFRESH_KEY) === null) {
    if (ls.getItem(OWNER_KEY) === null || e.key === REFRESH_KEY || e.key === null) void reconcileSession();
    return;
  }
  const theirs = tokenSubject(ls.getItem(ACCESS_KEY));
  const mine = st.user?.id ?? tokenSubject(api.getAccessToken());
  const owner = ls.getItem(OWNER_KEY);
  if ((theirs && mine && theirs !== mine) || (owner && mine && owner !== mine)) void reconcileSession();
}
globalThis.addEventListener?.("storage", (e) => onStorageEvent(e as StorageEvent));

type BootAttempt = "ready" | "login" | "unreachable" | "gone" | "replaced";

let bootLoop: Promise<boolean> | null = null;

/**
 * Boot the app into a workspace: fetch `/me`, choose a workspace (preferred →
 * last-used → first), start its sync client, and populate the store.
 *
 * Only a 401 drops to the login screen. Any other `/me` failure (server down,
 * 5xx, timeout) keeps the tokens, shows the "server unreachable" screen and
 * retries with backoff until `/me` answers - the login was still valid, and
 * sending the user to the login form for a DB outage was the bug.
 * Resolves true once booted, false when it ended on the login screen. A call
 * while a retry loop runs joins that loop.
 */
export function bootSession(preferredWorkspaceId?: string): Promise<boolean> {
  if (!bootLoop) {
    bootLoop = runBootLoop(preferredWorkspaceId).finally(() => {
      bootLoop = null;
    });
  }
  return bootLoop;
}

/** Immediate re-asks of /me after another tab's sign-in, before backing off. */
const FREE_REPLACED_RETRIES = 2;

async function runBootLoop(preferredWorkspaceId?: string): Promise<boolean> {
  let replaced = 0;
  for (let attempt = 0; ; attempt += 1) {
    // While retrying, another tab may have logged out. The access token this tab
    // holds stays valid on the server, so /me would boot the logged-out user.
    if (!loginStored()) {
      await loginGone();
      return false;
    }
    const outcome = await attemptBoot(preferredWorkspaceId);
    if (outcome === "gone") {
      await loginGone();
      return false;
    }
    if (outcome === "replaced") {
      // Another user signed in while /me was in flight: pick up their tokens, ask again.
      await api.hydrate();
      // A sign-in elsewhere settles within a round or two. If the stored token's
      // user and /me keep disagreeing (inconsistent storage), back off instead of
      // calling /me in a tight loop.
      replaced += 1;
      if (replaced > FREE_REPLACED_RETRIES) {
        await waitForRetry(bootRetryDelayMs(replaced - FREE_REPLACED_RETRIES - 1));
      }
      continue;
    }
    if (outcome !== "unreachable") return outcome === "ready";
    useApp.getState().setBoot("unreachable");
    await waitForRetry(bootRetryDelayMs(attempt));
  }
}

async function attemptBoot(preferredWorkspaceId?: string): Promise<BootAttempt> {
  let me: MeResponse;
  try {
    me = await api.getMe();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await expireSession();
      return "login";
    }
    return "unreachable";
  }
  // Logged out in another tab while /me was in flight: the answer was for a login
  // that no longer exists, and adopting its user would re-create the owner key.
  if (!loginStored()) return "gone";
  // Logged out and signed in as someone else meanwhile: /me answered for the
  // old login. Adopting its user would purge the new user's data.
  const stored = tokenSubject(globalThis.localStorage?.getItem(ACCESS_KEY) ?? null);
  if (stored && stored !== me.user.id) return "replaced";
  const st = useApp.getState();
  try {
    // Before anything reads local data: another user's queue must never be
    // hydrated, let alone flushed, under this account.
    adoptLocalDataFor(me.user.id, closeSync);
    const membership = pickMembership(me.memberships, preferredWorkspaceId, lastWorkspaceId());
    if (!membership) {
      st.setBoot("login");
      return "login";
    }
    initSync(membership.workspace.id, me.user.id);
    st.setSession(me.user, me.memberships, membership.workspace);
    void discardLostWorkspaces(me.memberships.map((m) => m.workspace.id));
    return "ready";
  } catch {
    // A local failure (e.g. storage quota) - retrying would not help.
    st.setBoot("login");
    return "login";
  }
}

const ACCESS_LOST_TOAST_MS = 8000;

/**
 * Every workspace this browser holds local data for that /me no longer lists was
 * revoked or deleted while the app was closed. Its queue would sit in
 * localStorage forever, so discard it and say how much was lost - once, in one
 * toast, however many workspaces it was.
 */
export async function discardLostWorkspaces(liveIds: string[]): Promise<void> {
  const live = new Set(liveIds);
  const messages: string[] = [];
  for (const id of listStoredWorkspaceIds()) {
    if (live.has(id)) continue;
    const discarded = await purgeWorkspaceStorage(id);
    if (discarded === 0 || !claimAccessLossNotice(id)) continue;
    messages.push(accessLostMessage(makeT(useApp.getState().locale), "removed", discarded, null));
  }
  if (messages.length > 0) {
    useApp.getState().showToast(messages.join(" "), { durationMs: ACCESS_LOST_TOAST_MS, tone: "error" });
  }
}

/** Whether `workspaceId` is the workspace the app currently has open. */
function isOpen(workspaceId: string): boolean {
  return (getSyncWorkspaceId() ?? useApp.getState().workspace?.id) === workspaceId;
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
    st.showToast(accessLostMessage(makeT(st.locale), info.reason, info.discarded, name), {
      durationMs: ACCESS_LOST_TOAST_MS,
      tone: "error",
    });
  }
  // A client the app already replaced (switch) reports too; only the open one moves.
  if (!isOpen(info.workspaceId)) return;
  await moveOffLostWorkspace(info.workspaceId);
}

const moving = new Map<string, Promise<void>>();

/**
 * Leave a workspace the user can no longer reach (revoked, deleted, left): land
 * in another one from /me and delete the lost one's local data. The server never
 * leaves an account workspace-less (§2, §7), so /me always has a survivor.
 * Concurrent calls for one workspace (the client's 403 and the caller's own
 * flow) share one move.
 */
export function moveOffLostWorkspace(lostId: string): Promise<void> {
  const running = moving.get(lostId);
  if (running) return running;
  const run = (async () => {
    await landOutside(lostId);
    // After landing: initSync has stopped the lost workspace's client, so nothing
    // re-persists behind the purge.
    await purgeWorkspaceStorage(lostId);
  })().finally(() => moving.delete(lostId));
  moving.set(lostId, run);
  return run;
}

async function landOutside(lostId: string): Promise<void> {
  try {
    const me = await api.getMe();
    // The user may have switched workspace while /me was in flight: keep that.
    if (!isOpen(lostId)) return;
    const memberships = me.memberships.filter((m) => m.workspace.id !== lostId);
    const next = pickMembership(memberships);
    if (next) {
      initSync(next.workspace.id, me.user.id);
      const st = useApp.getState();
      st.setSession(me.user, memberships, next.workspace);
      st.setWorkspace(next.workspace); // drop a view/selection that pointed into the lost workspace
      return;
    }
  } catch {
    /* server unreachable: fall back to what the store already knows */
  }
  if (!isOpen(lostId)) return;
  const st = useApp.getState();
  const survivors = st.memberships.filter((m) => m.workspace.id !== lostId);
  if (st.user && survivors[0]) {
    initSync(survivors[0].workspace.id, st.user.id);
    st.setMemberships(survivors);
    st.setWorkspace(survivors[0].workspace);
    return;
  }
  // Last resort, as after a workspace delete (SettingsView): re-boot, which drops
  // to login only if /me is still unreachable.
  await bootSession();
}

setAccessLostHandler((info) => {
  void handleAccessLost(info);
});
