import { pickMembership } from "@balu/domain";
import type { AccessLost } from "@balu/sync-client";
import { makeT } from "../i18n/index.js";
import {
  api,
  claimAccessLossNotice,
  getSyncWorkspaceId,
  initSync,
  isAccessLossExpected,
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
    const previous = lastWorkspaceId();
    const membership = pickMembership(me.memberships, preferredWorkspaceId, lastWorkspaceId());
    if (!membership) {
      st.setBoot("login");
      return false;
    }
    initSync(membership.workspace.id, me.user.id);
    st.setSession(me.user, me.memberships, membership.workspace);
    // The workspace this browser last had open is no longer in /me: access was
    // revoked or it was deleted while the app was closed. Its queue would sit in
    // localStorage forever, so discard it and say how much was lost.
    if (previous && !me.memberships.some((m) => m.workspace.id === previous)) {
      void discardLostWorkspace(previous);
    }
    return true;
  } catch {
    st.setBoot("login");
    return false;
  }
}

const ACCESS_LOST_TOAST_MS = 8000;

async function discardLostWorkspace(workspaceId: string): Promise<void> {
  const discarded = await purgeWorkspaceStorage(workspaceId);
  if (discarded === 0 || !claimAccessLossNotice(workspaceId)) return;
  const st = useApp.getState();
  st.showToast(accessLostMessage(makeT(st.locale), "removed", discarded, null), ACCESS_LOST_TOAST_MS);
}

/** The sync client lost access to a workspace (403/404): tell the user, move on. */
export async function handleAccessLost(info: AccessLost): Promise<void> {
  if (isAccessLossExpected(info.workspaceId)) return;
  const st = useApp.getState();
  if (claimAccessLossNotice(info.workspaceId)) {
    const name =
      st.memberships.find((m) => m.workspace.id === info.workspaceId)?.workspace.name ??
      (st.workspace?.id === info.workspaceId ? st.workspace.name : null);
    st.showToast(
      accessLostMessage(makeT(st.locale), info.reason, info.discarded, name),
      ACCESS_LOST_TOAST_MS,
    );
  }
  // A client the app already replaced (switch) reports too; only the open one moves.
  if (getSyncWorkspaceId() !== info.workspaceId) return;
  await moveOffLostWorkspace(info.workspaceId);
}

/**
 * Leave a workspace the user can no longer reach (revoked, deleted, left): land
 * in another one from /me and delete the lost one's local data. The server never
 * leaves an account workspace-less (§2, §7), so /me always has a survivor.
 */
export async function moveOffLostWorkspace(lostId: string): Promise<void> {
  await landOutside(lostId);
  // After landing: initSync has stopped the lost workspace's client, so nothing
  // re-persists behind the purge.
  await purgeWorkspaceStorage(lostId);
}

async function landOutside(lostId: string): Promise<void> {
  try {
    const me = await api.getMe();
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
