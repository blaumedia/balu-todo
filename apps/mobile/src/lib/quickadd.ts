import type { IsoDate, Label, Project } from '@balu/domain';
import { composeTaskArgs as compose, type ComposeContext, type ParseResult } from '@balu/nl-parser';

export {
  canQuickAddInto,
  resolveProjectId,
  resolveQuickAddContext,
  type QuickAddTarget,
} from '@balu/nl-parser';

export interface ComposeCtx {
  context: ComposeContext;
  projects: Project[];
  labels: Label[];
  today: IsoDate;
  /** Wall clock for the "time already passed today" rule; defaults to now. Tests pin it. */
  now?: Date;
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
    ...(ctx.now ? { now: ctx.now } : {}),
  });
}
