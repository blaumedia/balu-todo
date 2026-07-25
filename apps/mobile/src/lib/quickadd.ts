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
