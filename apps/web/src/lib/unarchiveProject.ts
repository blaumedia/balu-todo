import { nextProjectSortOrder } from "@balu/domain";
import type { SyncClient } from "@balu/sync-client";

/** Unarchive a project and put it back at the end of the project list. */
export function unarchiveProject(sync: SyncClient, id: string): void {
  sync.mutate({
    type: "project_update",
    args: { id, archived_at: null, sort_order: nextProjectSortOrder(sync.getSnapshot().projects) },
  });
}
