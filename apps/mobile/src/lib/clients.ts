// api-client + sync-client wiring. Unlike the web app the base URL is dynamic
// (a self-hosted server the user points at), so both clients are (re)created
// once the server URL is known.
import { createApiClient, type ApiClient } from '@balu/api-client';
import { createSyncClient, purgeWorkspaceData, type AccessLost, type SyncClient } from '@balu/sync-client';
import { Alert } from 'react-native';
import { makeT } from '../i18n';
import { useApp } from '../store/app';
import { sqliteKV } from './kv';
import { relocatedNotice } from './syncNotices';

let api: ApiClient | null = null;
let apiBaseUrl: string | null = null;
let sync: SyncClient | null = null;

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
export function isAccessLossExpected(workspaceId: string): boolean {
  return expectedLoss.has(workspaceId);
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

/** Delete one workspace's replica/queue/token; returns the discarded queue length. */
export function purgeWorkspaceStorage(workspaceId: string): Promise<number> {
  return purgeWorkspaceData(sqliteKV, workspaceId);
}

// The sync client is created asynchronously during boot, after root-level
// components have already mounted. They observe its (re)creation through this
// listener set so they can re-wire their replica subscriptions.
const syncClientListeners = new Set<(s: SyncClient | null) => void>();

/** Subscribe to sync-client creation/teardown. Returns an unsubscribe fn. */
export function subscribeSyncClient(cb: (s: SyncClient | null) => void): () => void {
  syncClientListeners.add(cb);
  return () => {
    syncClientListeners.delete(cb);
  };
}

function notifySyncClient(): void {
  for (const cb of syncClientListeners) cb(sync);
}

/** Normalize a server URL to its `/api/v1` REST base. */
export function apiBase(serverUrl: string): string {
  const trimmed = serverUrl.replace(/\/+$/, '');
  return `${trimmed}/api/v1`;
}

/** Create (or reuse) the API client for a given server URL. */
export function initApi(serverUrl: string): ApiClient {
  const base = apiBase(serverUrl);
  if (api && apiBaseUrl === base) return api;
  apiBaseUrl = base;
  api = createApiClient({ baseUrl: base, storage: sqliteKV });
  return api;
}

export function getApi(): ApiClient | null {
  return api;
}

export function initSync(serverUrl: string, workspaceId: string, userId: string): SyncClient {
  sync?.stop();
  // Landing in a workspace again (re-invite) resets its loss bookkeeping.
  expectedLoss.delete(workspaceId);
  announcedLoss.delete(workspaceId);
  const client = getApi();
  sync = createSyncClient({
    baseUrl: apiBase(serverUrl),
    workspaceId,
    userId,
    getAccessToken: () => client?.getAccessToken() ?? null,
    storage: sqliteKV,
    onAuthFail: async () => {
      await client?.refresh();
    },
    onCommandsRejected: (rejected) => {
      // The replica has already been re-pulled; tell the user their optimistic
      // change did not stick instead of letting it vanish silently.
      const { locale } = useApp.getState();
      Alert.alert(
        makeT(locale)('sync.error'),
        makeT(locale)('sync.rejected').replace('{n}', String(rejected.length)),
      );
    },
    onCommandsRelocated: (relocated) => {
      const notice = relocatedNotice(makeT(useApp.getState().locale), relocated);
      if (notice) Alert.alert(notice.title, notice.body);
    },
    onAccessLost: (info) => accessLostHandler?.(info),
  });
  sync.start();
  notifySyncClient();
  return sync;
}

export function getSync(): SyncClient | null {
  return sync;
}

export function teardownSync(): void {
  sync?.stop();
  sync = null;
  notifySyncClient();
}
