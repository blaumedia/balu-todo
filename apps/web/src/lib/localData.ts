/**
 * Keys that survive a purge. Only device-level display preferences - anything
 * else under `balu:` belongs to the account whose data this is.
 */
const KEEP = new Set(["balu:theme"]);
const AUTH_PREFIX = "balu:auth:";
/** The user id the local queue/replica belong to (set at every successful boot). */
export const OWNER_KEY = "balu:owner";

/**
 * Remove every `balu:*` key this app owns: the api-client's tokens
 * (`balu:auth:*`), the sync-client's per-workspace replica/queue/token
 * (`balu:{replica,queue,token}:<ws>`) and the last-used workspace.
 * `keepAuth` leaves the tokens alone (a different user just signed in).
 *
 * Without this the next person to use the browser still has the previous user's
 * tasks, notes and comments on disk, and any command left in the queue would be
 * flushed under whichever account logs in next.
 */
export function purgeLocalData(opts: { keepAuth?: boolean } = {}): void {
  const ls = globalThis.localStorage;
  if (!ls) return;
  const doomed: string[] = [];
  for (let i = 0; i < ls.length; i += 1) {
    const key = ls.key(i);
    if (
      key !== null &&
      key.startsWith("balu:") &&
      !KEEP.has(key) &&
      !(opts.keepAuth && key.startsWith(AUTH_PREFIX))
    ) {
      doomed.push(key);
    }
  }
  for (const key of doomed) ls.removeItem(key);
}

/**
 * Data stored with no owner key (web 1.3.2 cleared tokens on any refresh failure
 * and never recorded an owner): whose is it? Optimistic records the user created
 * offline (`tmp-*` ids) carry their id as `created_by` / `completed_by` / `author_id`.
 * Any such record naming someone else makes the data foreign; no evidence at all
 * keeps the old rule of adopting it, so the same user signing back in keeps their queue.
 */
function unownedDataIsForeign(ls: Storage, userId: string): boolean {
  const named = (id: unknown): boolean => typeof id === "string" && id !== "local" && id !== userId;
  for (let i = 0; i < ls.length; i += 1) {
    const key = ls.key(i);
    if (key === null || !key.startsWith("balu:replica:")) continue;
    try {
      const r = JSON.parse(ls.getItem(key) ?? "null") as {
        tasks?: Array<{ id?: string; created_by?: unknown; completed_by?: unknown }>;
        comments?: Array<{ id?: string; author_id?: unknown }>;
      } | null;
      for (const t of r?.tasks ?? []) {
        if (t.id?.startsWith("tmp-") && (named(t.created_by) || named(t.completed_by))) return true;
      }
      for (const c of r?.comments ?? []) {
        if (c.id?.startsWith("tmp-") && named(c.author_id)) return true;
      }
    } catch {
      /* unreadable: no evidence */
    }
  }
  return false;
}

/**
 * Make the local data `userId`'s. A session that expired keeps its queue and
 * replica for the same user (contract §1); when a different user signs in, the
 * previous user's data is wiped first. The new user's tokens are already
 * stored, so they are kept. A missing owner (fresh browser, after logout, or data
 * from before this key existed) is adopted unless the data names another user
 * (see unownedDataIsForeign). Returns true when it purged.
 */
export function adoptLocalDataFor(userId: string, beforePurge: () => void = () => {}): boolean {
  const ls = globalThis.localStorage;
  if (!ls) return false;
  const owner = ls.getItem(OWNER_KEY);
  const foreign = owner !== null ? owner !== userId : unownedDataIsForeign(ls, userId);
  if (foreign) {
    beforePurge();
    purgeLocalData({ keepAuth: true });
  }
  ls.setItem(OWNER_KEY, userId);
  return foreign;
}
