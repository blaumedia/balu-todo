import { useApp } from "../store/app.js";
import { api, closeSync } from "./clients.js";
import { wakeBootRetry } from "./bootRetry.js";
import { OWNER_KEY, purgeLocalData } from "./localData.js";

/** The one logout path: stop syncing, revoke server-side, wipe local state. */
export async function logout(): Promise<void> {
  // Close every sync client first, so nothing re-persists after the purge (a
  // queue written back without an owner key would be adopted, and flushed, by the
  // next user). Not awaited: a closed client never writes again and localStorage
  // writes are synchronous. api.logout() does not wait for a running refresh
  // either (its token write is generation-aware), so nothing here stalls.
  closeSync();
  // Before the tokens go: another tab seeing the refresh key vanish must find the
  // owner key already gone, or it takes this logout for an expiry and keeps the data.
  globalThis.localStorage?.removeItem(OWNER_KEY);
  // Started, not awaited: the request can take its whole timeout during an
  // outage, and a tab closed meanwhile must not reopen signed in with all the
  // data. api.logout() drops the stored tokens before it posts, and the revoke
  // never needs local state, so the purge does not wait for it.
  const revoked = api.logout().catch(() => {
    /* best-effort: local state is cleared regardless */
  });
  purgeLocalData();
  useApp.getState().reset();
  // The address bar must not keep the previous account's project/task ids on
  // screen. Shell unmounts with `reset()`, so useUrlSync's effect never runs to
  // rewrite it - do it here. replaceState, not assign(): no new history entry.
  globalThis.history?.replaceState(null, "", "/");
  // A boot retry loop waiting on an unreachable server must notice at once.
  wakeBootRetry();
  await revoked;
}
