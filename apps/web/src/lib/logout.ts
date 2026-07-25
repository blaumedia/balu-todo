import { useApp } from "../store/app.js";
import { api, teardownSync } from "./clients.js";

/**
 * Keys that survive a logout. Only device-level display preferences — anything
 * else under `balu:` belongs to the account that is signing out.
 */
const KEEP = new Set(["balu:theme"]);

/**
 * Remove every `balu:*` key this app owns: the api-client's tokens
 * (`balu:auth:*`), the sync-client's per-workspace replica/queue/token
 * (`balu:{replica,queue,token}:<ws>`) and the last-used workspace.
 *
 * Without this the next person to use the browser still has the previous user's
 * tasks, notes and comments on disk, and any command left in the queue would be
 * flushed under whichever account logs in next.
 */
export function purgeLocalData(): void {
  const ls = globalThis.localStorage;
  if (!ls) return;
  const doomed: string[] = [];
  for (let i = 0; i < ls.length; i += 1) {
    const key = ls.key(i);
    if (key !== null && key.startsWith("balu:") && !KEEP.has(key)) doomed.push(key);
  }
  for (const key of doomed) ls.removeItem(key);
}

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
}
