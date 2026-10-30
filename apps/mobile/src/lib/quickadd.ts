import type { IsoDate, Label, Project } from '@balu/domain';
import { composeTaskArgs as compose, type ParseResult } from '@balu/nl-parser';
import type { ComposeContext } from '../store/app';

export interface ComposeCtx {
  context: ComposeContext;
  projects: Project[];
  labels: Label[];
  today: IsoDate;
}

/**
 * Turn a parsed quick-add string into `task_add` args. The logic lives in
 * `@balu/nl-parser` so web and mobile cannot drift; this only adapts the
 * mobile store's ComposeContext (which is already the shared shape).
 */
export function composeTaskArgs(
  text: string,
  result: ParseResult,
  ctx: ComposeCtx,
): Record<string, unknown> {
  return compose(text, result, {
    projects: ctx.projects,
    labels: ctx.labels,
    today: ctx.today,
    context: ctx.context,
  });
}

/**
 * Whether the project screen offers quick-add into this project: only for
 * members who may write, and never into a project that is missing (not loaded
 * yet), deleted (the screen is about to pop) or archived (unarchive first -
 * the MCP refuses placing tasks there too; web still allows it).
 */
export function canQuickAddInto(
  project: Pick<Project, 'is_deleted' | 'archived_at'> | undefined,
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
 */
export function resolveQuickAddContext(
  context: ComposeContext,
  projects: ReadonlyArray<Pick<Project, 'id' | 'is_deleted' | 'archived_at'>>,
  aliases: Readonly<Record<string, string>>,
): QuickAddTarget {
  if (context.kind !== 'project') return { context, redirected: false };
  const projectId = resolveProjectId(aliases, context.projectId);
  const project = projects.find((p) => p.id === projectId);
  if (canQuickAddInto(project, true)) return { context: { kind: 'project', projectId }, redirected: false };
  return { context: { kind: 'list', list: 'inbox' }, redirected: true };
}
