import { useSyncExternalStore } from "react";
import type { Snapshot } from "@balu/sync-client";
import { getSync } from "../lib/clients.js";

const EMPTY: Snapshot = {
  projects: [],
  sections: [],
  tasks: [],
  labels: [],
  comments: [],
  attachments: [],
  members: [],
  status: "offline",
  syncToken: "*",
  pending: 0,
};

const noopSubscribe = (): (() => void) => () => {};

/** Bind the sync-client replica snapshot into React via useSyncExternalStore. */
export function useSnapshot(): Snapshot {
  const sync = getSync();
  return useSyncExternalStore(
    sync ? sync.subscribe : noopSubscribe,
    sync ? sync.getSnapshot : () => EMPTY,
    () => EMPTY,
  );
}
