// Project list helpers shared by the web sidebar and the mobile Browse tab so
// "which projects are shown where" has a single definition.
import type { Project, ProjectColor } from "./types.js";
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
