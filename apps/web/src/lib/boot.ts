import type { Membership } from "@balu/domain";
import { api, initSync } from "./clients.js";
import { lastWorkspaceId, useApp } from "../store/app.js";

/** Pick the membership to open: an explicit id, else the last-used, else first. */
function pickMembership(memberships: Membership[], preferredId?: string): Membership | undefined {
  if (preferredId) {
    const explicit = memberships.find((m) => m.workspace.id === preferredId);
    if (explicit) return explicit;
  }
  const last = lastWorkspaceId();
  if (last) {
    const remembered = memberships.find((m) => m.workspace.id === last);
    if (remembered) return remembered;
  }
  return memberships[0];
}

/**
 * Boot the app into a workspace: fetch `/me`, choose a workspace (preferred →
 * last-used → first), start its sync client, and populate the store. Returns
 * false and drops to the login screen when there is no membership.
 */
export async function bootSession(preferredWorkspaceId?: string): Promise<boolean> {
  const st = useApp.getState();
  try {
    const me = await api.getMe();
    const membership = pickMembership(me.memberships, preferredWorkspaceId);
    if (!membership) {
      st.setBoot("login");
      return false;
    }
    initSync(membership.workspace.id, me.user.id);
    st.setSession(me.user, me.memberships, membership.workspace);
    return true;
  } catch {
    st.setBoot("login");
    return false;
  }
}
