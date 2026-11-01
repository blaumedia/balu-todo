import type { Snapshot } from '@balu/sync-client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { commentCountsByTask, type Label, type Member, type Project, type Section } from '@balu/domain';
import { getSync, subscribeSyncClient } from '../lib/clients';

const EMPTY: Snapshot = {
  projects: [],
  sections: [],
  tasks: [],
  labels: [],
  comments: [],
  attachments: [],
  members: [],
  status: 'offline',
  syncToken: '*',
  pending: 0,
  idAliases: {},
  hasSynced: false,
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
  /** Workspace members by id — drives the assignee chip on rows. */
  members: Map<string, Member>;
  /** Open comment count per task id — drives the comment chip on rows. */
  commentCounts: Map<string, number>;
}

export function useMaps(snapshot: Snapshot): ReplicaMaps {
  // Only these slices: `snapshot` itself changes on every task edit and would
  // rebuild every map.
  const { projects, labels, sections, members, comments } = snapshot;
  return useMemo(
    () => ({
      projects: new Map(projects.map((p) => [p.id, p])),
      labels: new Map(labels.map((l) => [l.id, l])),
      sections: new Map(sections.map((s) => [s.id, s])),
      members: new Map(members.map((m) => [m.id, m])),
      commentCounts: commentCountsByTask(comments),
    }),
    [projects, labels, sections, members, comments],
  );
}
