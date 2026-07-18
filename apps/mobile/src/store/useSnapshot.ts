import type { Snapshot } from '@balu/sync-client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Label, Project, Section } from '@balu/domain';
import { getSync, subscribeSyncClient } from '../lib/clients';

const EMPTY: Snapshot = {
  projects: [],
  sections: [],
  tasks: [],
  labels: [],
  members: [],
  status: 'offline',
  syncToken: '*',
  pending: 0,
};

const noopSubscribe = (): (() => void) => () => {};

/** Bind the sync-client replica snapshot into React via useSyncExternalStore. */
export function useSnapshot(): Snapshot {
  // Components (e.g. the root-level sheets) can mount before bootApp() has
  // created the sync client. Track the client as state so its creation
  // triggers a re-render that re-wires the store subscription — a plain
  // `getSync()` read here left early mounters stuck on the empty snapshot
  // forever (detail sheet never opened after a cold start).
  const [sync, setSync] = useState(getSync);
  useEffect(() => {
    const unsub = subscribeSyncClient(setSync);
    setSync(getSync()); // in case it appeared between render and effect
    return unsub;
  }, []);
  return useSyncExternalStore(
    sync ? sync.subscribe : noopSubscribe,
    sync ? sync.getSnapshot : () => EMPTY,
    () => EMPTY,
  );
}

export interface ReplicaMaps {
  projects: Map<string, Project>;
  labels: Map<string, Label>;
  sections: Map<string, Section>;
}

export function useMaps(snapshot: Snapshot): ReplicaMaps {
  return useMemo(
    () => ({
      projects: new Map(snapshot.projects.map((p) => [p.id, p])),
      labels: new Map(snapshot.labels.map((l) => [l.id, l])),
      sections: new Map(snapshot.sections.map((s) => [s.id, s])),
    }),
    [snapshot.projects, snapshot.labels, snapshot.sections],
  );
}
