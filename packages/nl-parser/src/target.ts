// Where quick-add files a new task (contract §5.3 temp ids). Shared by web and
// mobile so "which projects still accept tasks" has one definition. Typed
// structurally, like compose.ts, so this needs no @balu/domain dependency.

import type { ComposeContext } from "./compose.js";

/** The slice of a project these helpers look at. */
export interface TargetProject {
  id: string;
  is_deleted: boolean;
  archived_at: string | null;
}

/**
 * Whether a project accepts new tasks from quick-add: only for members who may
 * write, and never into a project that is missing (not loaded yet), deleted or
 * archived (unarchive first - the MCP refuses placing tasks there too).
 */
export function canQuickAddInto(
  project: Pick<TargetProject, "is_deleted" | "archived_at"> | undefined,
  writable: boolean,
): boolean {
  return writable && project != null && !project.is_deleted && project.archived_at == null;
}

/**
 * The id a screen or compose context should use now: a temp id the server has
 * since replaced resolves to the real one, anything else is returned as is.
 * Own keys only, so an id like "constructor" never hits Object.prototype.
 */
export function resolveProjectId(aliases: Readonly<Record<string, string>>, id: string): string {
  return Object.prototype.hasOwnProperty.call(aliases, id) ? (aliases[id] ?? id) : id;
}

export interface QuickAddTarget {
  context: ComposeContext;
  /** The project context was unusable (missing, deleted, archived) and was swapped for the Inbox. */
  redirected: boolean;
}

/**
 * Where quick-add should compose into. A project context that no longer
 * accepts tasks falls back to the Inbox instead of filing into a dead id;
 * an explicit #project token in the text still wins (composeTaskArgs).
 * A temp project id that was remapped is followed, not treated as gone.
 * A project absent from the list is only treated as gone when `confirmed`
 * (the data is known complete, e.g. synced): before the first sync the replica
 * may simply not be loaded, so the project context is kept. Deleted or
 * archived projects present in the list redirect regardless.
 */
export function resolveQuickAddContext(
  context: ComposeContext,
  projects: ReadonlyArray<TargetProject>,
  aliases: Readonly<Record<string, string>>,
  confirmed = true,
): QuickAddTarget {
  if (context.kind !== "project") return { context, redirected: false };
  const projectId = resolveProjectId(aliases, context.projectId);
  const project = projects.find((p) => p.id === projectId);
  if (!project && !confirmed) return { context: { kind: "project", projectId }, redirected: false };
  if (canQuickAddInto(project, true)) return { context: { kind: "project", projectId }, redirected: false };
  return { context: { kind: "list", list: "inbox" }, redirected: true };
}
