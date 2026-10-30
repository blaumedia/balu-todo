import { resolveProjectId } from "@balu/nl-parser";

/** What Shell does with a project view after a snapshot change. */
export type ProjectViewAction =
  | { kind: "keep" }
  | { kind: "follow"; projectId: string }
  | { kind: "today" };

export interface ProjectViewInput {
  projectId: string;
  projects: ReadonlyArray<{ id: string; is_deleted: boolean }>;
  aliases: Readonly<Record<string, string>>;
  /** snapshot.status === "synced" - the only "replica confirmed" signal. */
  synced: boolean;
  quickAddOpen: boolean;
}

/**
 * A temp id the server replaced is followed to the real id at once (aliases
 * only come from server responses, so no status gate). A project that is
 * really missing or deleted heals to Today, but only on confirmed data and
 * never under an open quick-add (its submit guard redirects with a notice;
 * the heal follows when it closes).
 */
export function projectViewAction(s: ProjectViewInput): ProjectViewAction {
  const real = resolveProjectId(s.aliases, s.projectId);
  if (real !== s.projectId) return { kind: "follow", projectId: real };
  if (!s.synced || s.quickAddOpen) return { kind: "keep" };
  const exists = s.projects.some((p) => p.id === s.projectId && !p.is_deleted);
  return exists ? { kind: "keep" } : { kind: "today" };
}
