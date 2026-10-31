import { pickMembership } from "@balu/domain";
import type { AccessLost } from "@balu/sync-client";
import { makeT } from "../i18n/index.js";
import {
  api,
  claimAccessLossNotice,
  getSyncWorkspaceId,
  initSync,
  listStoredWorkspaceIds,
  purgeWorkspaceStorage,
  setAccessLostHandler,
} from "./clients.js";
import { accessLostMessage } from "./syncNotices.js";
import { lastWorkspaceId, useApp } from "../store/app.js";

/**
 * Boot the app into a workspace: fetch `/me`, choose a workspace (preferred →
 * last-used → first), start its sync client, and populate the store. Returns
 * false and drops to the login screen when there is no membership.
 */
export async function bootSession(preferredWorkspaceId?: string): Promise<boolean> {
  const st = useApp.getState();
  try {
    const me = await api.getMe();
    const membership = pickMembership(me.memberships, preferredWorkspaceId, lastWorkspaceId());
    if (!membership) {
      st.setBoot("login");
      return false;
    }
    initSync(membership.workspace.id, me.user.id);
    st.setSession(me.user, me.memberships, membership.workspace);
    void discardLostWorkspaces(me.memberships.map((m) => m.workspace.id));
    return true;
  } catch {
    st.setBoot("login");
    return false;
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
