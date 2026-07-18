import { useMemo } from "react";
import type { Label, Project, Section } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";

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
