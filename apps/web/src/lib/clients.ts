import { createApiClient, type ApiClient } from "@balu/api-client";
import {
  clearLossNotice,
  createSyncClient,
  localStorageKV,
  purgeWorkspaceData,
  workspaceStorageKeys,
  type AccessLost,
  type PurgedWorkspace,
  type SyncClient,
} from "@balu/sync-client";
import { makeT } from "../i18n/index.js";
import { useApp } from "../store/app.js";
import { relocatedMessage } from "./syncNotices.js";

// One localStorage KV shared by both clients (structurally identical interfaces).
const kv = localStorageKV();

let sessionExpiredHandler: (() => void) | null = null;
/** Registered by lib/boot.ts (a hook, not an import: boot.ts imports this module). */
export function setSessionExpiredHandler(handler: () => void): void {
  sessionExpiredHandler = handler;
}

let sessionEndedElsewhereHandler: (() => void) | null = null;
/** Registered by lib/boot.ts, like the expiry hook. */
export function setSessionEndedElsewhereHandler(handler: () => void): void {
  sessionEndedElsewhereHandler = handler;
}

export const api: ApiClient = createApiClient({
  baseUrl: "/api/v1",
  storage: kv,
  onSessionExpired: () => sessionExpiredHandler?.(),
  onSessionEndedElsewhere: () => sessionEndedElsewhereHandler?.(),
});

const RELOCATED_TOAST_MS = 5000;
const REJECTED_TOAST_MS = 6000;

// A flush can report rejected and relocated commands in the same tick, and the
// toast has one slot: the second would replace the first unseen. Collect what
// arrives in one tick and show it as a single message.
let batchedSyncToast: { parts: string[]; durationMs: number; tone: "info" | "error" } | null = null;
function queueSyncToast(message: string, durationMs: number, tone: "info" | "error"): void {
  if (batchedSyncToast) {
    batchedSyncToast.parts.push(message);
    batchedSyncToast.durationMs = Math.max(batchedSyncToast.durationMs, durationMs);
    if (tone === "error") batchedSyncToast.tone = "error";
    return;
  }
  batchedSyncToast = { parts: [message], durationMs, tone };
  queueMicrotask(() => {
    const t = batchedSyncToast;
    batchedSyncToast = null;
    if (t) useApp.getState().showToast(t.parts.join(" "), { durationMs: t.durationMs, tone: t.tone });
  });
}

/** Storage ids of every workspace this browser holds local sync data for. */
export function listStoredWorkspaceIds(): string[] {
  const ls = globalThis.localStorage;
  const ids = new Set<string>();
  if (!ls) return [];
  // lossNotice too: a purge killed after the queue was removed leaves only that key.
  const prefixes = ["queue", "replica", "token", "lossNotice"].map((k) => workspaceStorageKeys("")[k as "queue"]);
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    const prefix = key ? prefixes.find((p) => key.startsWith(p)) : undefined;
    if (key && prefix && key.length > prefix.length) ids.add(key.slice(prefix.length));
  }
  return [...ids];
}

// Workspaces whose loss the app caused itself (delete, leave): the sync client's
// 403/404 for them must not tell the user what they just did.
const expectedLoss = new Set<string>();
// Losses already announced this session, so the live path (sync client) and the
// boot path (/me without the last-used workspace) never both report one.
const announcedLoss = new Set<string>();

export function expectAccessLoss(workspaceId: string): void {
  expectedLoss.add(workspaceId);
}
export function clearExpectedAccessLoss(workspaceId: string): void {
  expectedLoss.delete(workspaceId);
}
/** True when the user should be told about losing `workspaceId`; marks it told. */
export function claimAccessLossNotice(workspaceId: string): boolean {
  if (expectedLoss.has(workspaceId) || announcedLoss.has(workspaceId)) return false;
  announcedLoss.add(workspaceId);
  return true;
}

let accessLostHandler: ((info: AccessLost) => void) | null = null;
/** Registered by lib/boot.ts, which owns the recovery. A hook rather than an
 *  import because boot.ts imports this module. */
export function setAccessLostHandler(handler: (info: AccessLost) => void): void {
  accessLostHandler = handler;
}

/** Delete one workspace's replica/queue/token; returns the discarded queue length and why it was lost. */
export function purgeWorkspaceStorage(workspaceId: string): Promise<PurgedWorkspace> {
  return purgeWorkspaceData(kv, workspaceId);
}

/** Drop a loss notice left for a workspace that is reachable again. */
export function clearWorkspaceLossNotice(workspaceId: string): Promise<void> {
  return clearLossNotice(kv, workspaceId);
}

let sync: SyncClient | null = null;
let syncWorkspaceId: string | null = null;
let unsubToast: () => void = () => {};

/**
 * Clients that were stopped (workspace switch, session expiry) but whose running
 * pull or flush has not settled yet. `stop()` does not cancel that work, and it
 * writes the old workspace's queue/replica/token when it lands - so a purge or an
 * adoption by another user must reach these too, not only the current client.
 */
const retired = new Map<SyncClient, string>();

/** Stop `client` and keep it reachable until its running work has settled. */
function retire(client: SyncClient | null, workspaceId: string | null): void {
  if (!client || workspaceId === null) return;
  // Only ever passed the current client; a retired one keeps emitting until idle().
  unsubToast();
  unsubToast = () => {};
  client.stop();
  retired.set(client, workspaceId);
  const settled = (): void => {
    retired.delete(client);
  };
  client.idle().then(settled, settled);
}

/**
 * (Re)instantiate the sync client for a workspace. The sync-client persists its
 * queue/token/replica under workspace-scoped keys (`balu:{queue,token,replica}:<id>`),
 * so switching workspaces never mixes data — the old instance is stopped and a
 * fresh one hydrates from that workspace's own keys.
 */
export function initSync(workspaceId: string, userId: string): SyncClient {
  // A stopped client of this same workspace (A -> B -> A) would still write the
  // same keys the new client is about to own, and a late write would overwrite
  // its newer state. Closing is safe: the server replays commands by uuid.
  for (const [client, id] of retired) if (id === workspaceId) client.close();
  if (syncWorkspaceId === workspaceId) sync?.close();
  retire(sync, syncWorkspaceId);
  // Landing in a workspace again (re-invite) resets its loss bookkeeping.
  expectedLoss.delete(workspaceId);
  announcedLoss.delete(workspaceId);
  syncWorkspaceId = workspaceId;
  sync = createSyncClient({
    baseUrl: "/api/v1",
    workspaceId,
    userId,
    getAccessToken: () => api.getAccessToken(),
    storage: kv,
    onAuthFail: async () => {
      await api.refresh();
    },
    onCommandsRejected: (rejected) => {
      // The replica has already been re-pulled; tell the user their optimistic
      // change did not stick instead of letting it vanish silently.
      const { locale } = useApp.getState();
      queueSyncToast(
        makeT(locale)("sync.rejected").replace("{n}", String(rejected.length)),
        REJECTED_TOAST_MS,
        "error",
      );
    },
    onCommandsRelocated: (relocated) => {
      const message = relocatedMessage(makeT(useApp.getState().locale), relocated);
      if (message) queueSyncToast(message, RELOCATED_TOAST_MS, "info");
    },
    onAccessLost: (info) => accessLostHandler?.(info),
  });
  // Toast staleness follows the replica (e.g. a project unarchived elsewhere).
  unsubToast = sync.subscribe(() => useApp.getState().revalidateToast());
  sync.start();
  useApp.getState().revalidateToast();
  return sync;
}

export function getSync(): SyncClient | null {
  return sync;
}

export function getSyncWorkspaceId(): string | null {
  return syncWorkspaceId;
}

/**
 * Close every sync client for good - the current one and any stopped one still
 * winding down - so none of them ever writes to storage again (not even a pull
 * or flush already in flight) and drop the current one. For when the stored data
 * is about to be wiped or handed to another user; `teardownSync` only stops it.
 * localStorage writes are synchronous, so once closed nothing can land half-done
 * and there is nothing to wait for.
 */
export function closeSync(): void {
  for (const client of retired.keys()) client.close();
  sync?.close();
  unsubToast();
  unsubToast = () => {};
  sync = null;
  syncWorkspaceId = null;
  useApp.getState().revalidateToast();
}

export function teardownSync(): void {
  retire(sync, syncWorkspaceId);
  sync = null;
  syncWorkspaceId = null;
  useApp.getState().revalidateToast();
}
