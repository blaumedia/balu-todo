import type { IsoDate, Label, Project } from '@balu/domain';
import { composeTaskArgs as compose, type ComposeContext, type ParseResult } from '@balu/nl-parser';

export {
  canQuickAddInto,
  resolveProjectId,
  resolveQuickAddContext,
  type QuickAddTarget,
} from '@balu/nl-parser';

/**
 * Whether `addTask`/`mutate()` actually saved the edit. A client without access
 * (or closed, or none at all) drops it: show no success feedback then, it would be
 * false.
 */
export function wasSaved(result: { dropped?: boolean } | undefined): boolean {
  return result !== undefined && !result.dropped;
}

export interface ComposeCtx {
  context: ComposeContext;
  projects: Project[];
  labels: Label[];
  today: IsoDate;
}

/**
 * Turn a parsed quick-add string into `task_add` args. The logic lives in
 * `@balu/nl-parser` so web and mobile cannot drift; this only adapts the
 * mobile store's ComposeContext (a subset of the shared shape).
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
