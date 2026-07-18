import { createApiClient, type ApiClient } from "@balu/api-client";
import { createSyncClient, localStorageKV, type SyncClient } from "@balu/sync-client";

// One localStorage KV shared by both clients (structurally identical interfaces).
const kv = localStorageKV();

export const api: ApiClient = createApiClient({ baseUrl: "/api/v1", storage: kv });

let sync: SyncClient | null = null;

export function initSync(workspaceId: string, userId: string): SyncClient {
  sync?.stop();
  sync = createSyncClient({
    baseUrl: "/api/v1",
    workspaceId,
    userId,
    getAccessToken: () => api.getAccessToken(),
    storage: kv,
    onAuthFail: async () => {
      await api.refresh();
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
