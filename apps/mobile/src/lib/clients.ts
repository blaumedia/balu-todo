// api-client + sync-client wiring. Unlike the web app the base URL is dynamic
// (a self-hosted server the user points at), so both clients are (re)created
// once the server URL is known.
import { createApiClient, type ApiClient } from '@balu/api-client';
import { createSyncClient, type SyncClient } from '@balu/sync-client';
import { sqliteKV } from './kv';

let api: ApiClient | null = null;
let apiBaseUrl: string | null = null;
let sync: SyncClient | null = null;

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
  });
  sync.start();
  return sync;
}

export function getSync(): SyncClient | null {
  return sync;
}

export function teardownSync(): void {
  sync?.stop();
  sync = null;
}
