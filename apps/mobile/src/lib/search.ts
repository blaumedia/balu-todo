// Local replica search across tasks, projects and labels.
//
// NOTE: plan 06 asks to reuse `searchItems` from `@balu/domain` if plan 05
// landed it — it has not (no such export in packages/domain/src as of this
// change), and this agent must not edit packages/ in parallel. So the logic
// lives here for now; flagged for later consolidation into @balu/domain.
import { isOpen, type Label, type Project, type Task } from '@balu/domain';

export interface SearchResults {
  tasks: Task[];
  projects: Project[];
  labels: Label[];
}

export interface SearchInput {
  tasks: readonly Task[];
  projects: readonly Project[];
  labels: readonly Label[];
  /** Raw query text; trimmed + lower-cased internally. */
  query: string;
  /** Include completed tasks in results (default: open only). */
  includeCompleted?: boolean;
  /** Max tasks returned (projects/labels are naturally small). */
  cap?: number;
}

const TASK_CAP = 100;

/**
 * Case-insensitive substring search. Tasks match on title OR notes; projects
 * and labels match on name. Empty query returns nothing. Pure and total.
 */
export function searchReplica(input: SearchInput): SearchResults {
  const q = input.query.trim().toLowerCase();
  if (!q) return { tasks: [], projects: [], labels: [] };
  const cap = input.cap ?? TASK_CAP;

  const tasks = input.tasks
    .filter((task) => {
      if (task.is_deleted) return false;
      if (!input.includeCompleted && !isOpen(task)) return false;
      return task.title.toLowerCase().includes(q) || task.notes.toLowerCase().includes(q);
    })
    // Open before completed, then alphabetical by title.
    .sort((a, b) => {
      const oa = a.completed_at == null ? 0 : 1;
      const ob = b.completed_at == null ? 0 : 1;
      return oa - ob || a.title.localeCompare(b.title);
    })
    .slice(0, cap);

  const projects = input.projects
    .filter((p) => !p.is_deleted && p.archived_at == null && p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  const labels = input.labels
    .filter((l) => !l.is_deleted && l.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { tasks, projects, labels };
}
