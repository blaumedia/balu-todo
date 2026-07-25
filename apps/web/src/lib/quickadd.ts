import type { IsoDate, Label, Project } from "@balu/domain";
import { composeTaskArgs as compose, type ComposeContext, type ParseResult } from "@balu/nl-parser";
import type { ViewSel } from "../store/app.js";

export interface ComposeCtx {
  view: ViewSel;
  projects: Project[];
  labels: Label[];
  today: IsoDate;
}

/** Map the web app's view selection onto the shared compose context. */
function contextOf(view: ViewSel): ComposeContext {
  if (view.kind === "project") return { kind: "project", projectId: view.projectId };
  if (view.kind === "list") return { kind: "list", list: view.list };
  return { kind: "none" };
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
    context: contextOf(ctx.view),
  });
}
