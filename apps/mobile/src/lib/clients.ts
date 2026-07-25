// api-client + sync-client wiring. Unlike the web app the base URL is dynamic
// (a self-hosted server the user points at), so both clients are (re)created
// once the server URL is known.
import { createApiClient, type ApiClient } from '@balu/api-client';
import { createSyncClient, type SyncClient } from '@balu/sync-client';
import { Alert } from 'react-native';
import { makeT } from '../i18n';
import { useApp } from '../store/app';
import { sqliteKV } from './kv';

let api: ApiClient | null = null;
let apiBaseUrl: string | null = null;
let sync: SyncClient | null = null;

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
