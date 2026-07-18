import type { Snapshot } from '@balu/sync-client';
import { useMemo, useSyncExternalStore } from 'react';
import type { Label, Project, Section } from '@balu/domain';
import { getSync } from '../lib/clients';

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
  const sync = getSync();
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
