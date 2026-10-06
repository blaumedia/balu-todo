// Project list helpers shared by the web sidebar and the mobile Browse tab so
// "which projects are shown where" has a single definition.
import { nextSortOrder } from "./helpers.js";
import type { Project, ProjectColor, Task } from "./types.js";
/** Every color the server accepts (contract §3.1 enum, `VALID_COLORS` in commands.py), in palette order. */
export const PROJECT_COLORS: ReadonlyArray<ProjectColor> = [
  "slate", "red", "orange", "amber", "green", "teal",
  "cyan", "blue", "indigo", "violet", "pink", "rose",
];
const bySort = (a: Project, b: Project) => a.sort_order - b.sort_order;
/** Live projects: not deleted, not archived, in sidebar order. */
export function activeProjects(projects: ReadonlyArray<Project>): Project[] {
  return projects.filter((p) => !p.is_deleted && p.archived_at == null).sort(bySort);
}
/** Archived (but not deleted) projects, in the same sidebar order. */
export function archivedProjects(projects: ReadonlyArray<Project>): Project[] {
  return projects.filter((p) => !p.is_deleted && p.archived_at != null).sort(bySort);
}
/** Ids of archived (not deleted) projects. A deleted project's tasks are already gone, so it needs no entry. */
export function archivedProjectIds(projects: ReadonlyArray<Project>): Set<string> {
  const ids = new Set<string>();
  for (const p of projects) if (!p.is_deleted && p.archived_at != null) ids.add(p.id);
  return ids;
}
/**
 * The project a task sits in: its own, or its parent's for a subtask that
 * carries none. Same resolution as the orphan pass of `project_delete`
 * (sync-client `apply.ts`, server `h_project_delete`).
 */
export function effectiveProjectId(t: Task, tasksById: ReadonlyMap<string, Task>): string | null {
  if (t.project_id != null) return t.project_id;
  if (t.parent_task_id == null) return null;
  return tasksById.get(t.parent_task_id)?.project_id ?? null;
}
/**
 * Archived = out of sight: an archived project's tasks leave every smart list,
 * count and search result and are only seen inside that project. Returns the
 * input array itself when nothing is archived.
 */
export function excludeArchivedProjectTasks(
  tasks: ReadonlyArray<Task>,
  projects: ReadonlyArray<Project>,
): ReadonlyArray<Task> {
  const archived = archivedProjectIds(projects);
  if (archived.size === 0) return tasks;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter((t) => {
    const pid = effectiveProjectId(t, byId);
    return pid == null || !archived.has(pid);
  });
}
/**
 * Append position for a project: after every non-deleted project, archived
 * ones included (the server's `project_add` default does the same), so an
 * unarchived project lands at the end instead of tying with old neighbours.
 */
export function nextProjectSortOrder(projects: ReadonlyArray<Project>): number {
  return nextSortOrder(projects.filter((p) => !p.is_deleted));
}
