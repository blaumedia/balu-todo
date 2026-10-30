import type { IsoDate, Label, Project } from "@balu/domain";
import { composeTaskArgs as compose, resolveQuickAddContext, type ComposeContext, type ParseResult, type QuickAddTarget } from "@balu/nl-parser";
import type { ViewSel } from "../store/app.js";

export interface ComposeCtx {
  context: ComposeContext;
  projects: Project[];
  labels: Label[];
  today: IsoDate;
}

/** Map the web app's view selection onto the shared compose context. */
export function contextOf(view: ViewSel): ComposeContext {
  if (view.kind === "project") return { kind: "project", projectId: view.projectId };
  if (view.kind === "list") return { kind: "list", list: view.list };
  return { kind: "none" };
}

/**
 * Where quick-add composes into from this view: a temp project id the server
 * has replaced is followed, and a project that is missing, deleted or archived
 * falls back to the Inbox (redirected) - the same rule mobile uses.
 */
export function quickAddTarget(
  view: ViewSel,
  projects: ReadonlyArray<Project>,
  aliases: Readonly<Record<string, string>>,
): QuickAddTarget {
  return resolveQuickAddContext(contextOf(view), projects, aliases);
}

/** Whether to toast that the task landed in the Inbox: only when the view's
 *  project was redirected and the user did not name a project via `#`. */
export function shouldNotifyInbox(target: QuickAddTarget, args: Record<string, unknown>): boolean {
  return target.redirected && args["project_id"] === undefined;
}

/**
 * Turn a parsed quick-add string into `task_add` args. The logic lives in
 * `@balu/nl-parser` so web and mobile cannot drift (acceptance criterion 5:
 * unmatched `#`/`@` tokens stay as literal title text).
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
