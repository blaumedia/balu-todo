import { useApp } from "../store/app.js";
import { api, teardownSync } from "./clients.js";
import { purgeLocalData } from "./localData.js";

/** The one logout path: stop syncing, revoke server-side, wipe local state. */
export async function logout(): Promise<void> {
  // Stop the sync client first so nothing re-persists after the purge.
  teardownSync();
  try {
    await api.logout();
  } catch {
    /* best-effort: local state is cleared regardless */
  }
  purgeLocalData();
  useApp.getState().reset();
  // The address bar must not keep the previous account's project/task ids on
  // screen. Shell unmounts with `reset()`, so useUrlSync's effect never runs to
  // rewrite it - do it here. replaceState, not assign(): no new history entry.
  globalThis.history?.replaceState(null, "", "/");
}
