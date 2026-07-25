import { createApiClient, type ApiClient } from "@balu/api-client";
import { createSyncClient, localStorageKV, type SyncClient } from "@balu/sync-client";
import { makeT } from "../i18n/index.js";
import { useApp } from "../store/app.js";

// One localStorage KV shared by both clients (structurally identical interfaces).
const kv = localStorageKV();

export const api: ApiClient = createApiClient({ baseUrl: "/api/v1", storage: kv });

let sync: SyncClient | null = null;
let syncWorkspaceId: string | null = null;

/**
 * (Re)instantiate the sync client for a workspace. The sync-client persists its
 * queue/token/replica under workspace-scoped keys (`balu:{queue,token,replica}:<id>`),
 * so switching workspaces never mixes data — the old instance is stopped and a
 * fresh one hydrates from that workspace's own keys.
 */
export function initSync(workspaceId: string, userId: string): SyncClient {
  sync?.stop();
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
      const { locale, showToast } = useApp.getState();
      showToast(makeT(locale)("sync.rejected").replace("{n}", String(rejected.length)));
    },
  });
  sync.start();
  return sync;
}

export function getSync(): SyncClient | null {
  return sync;
}

export function getSyncWorkspaceId(): string | null {
  return syncWorkspaceId;
}

export function teardownSync(): void {
  sync?.stop();
  sync = null;
  syncWorkspaceId = null;
}
