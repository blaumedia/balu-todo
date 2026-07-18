import type { IsoDate, Label, Project } from "@balu/domain";
import { buildTitle, type ParseResult, type Token } from "@balu/nl-parser";
import type { ViewSel } from "../store/app.js";

export interface ComposeCtx {
  view: ViewSel;
  projects: Project[];
  labels: Label[];
  today: IsoDate;
}

/**
 * Turn a parsed quick-add string into `task_add` args. Only *existing*
 * projects/labels match; unmatched `#`/`@` tokens stay as literal title text
 * (acceptance criterion 5).
 */
export function composeTaskArgs(text: string, result: ParseResult, ctx: ComposeCtx): Record<string, unknown> {
  const matchByName = <T extends { name: string; is_deleted: boolean }>(items: T[], q: string) =>
    items.find((i) => !i.is_deleted && i.name.toLowerCase() === q.toLowerCase());

  let projectId: string | undefined;
  const labelIds: string[] = [];
  const strip: Token[] = [];

  for (const tok of result.tokens) {
    if (tok.type === "project") {
      const p = matchByName(ctx.projects, String(tok.value));
      if (p) {
        if (!projectId) projectId = p.id;
        strip.push(tok);
      }
    } else if (tok.type === "label") {
      const l = matchByName(ctx.labels, String(tok.value));
      if (l) {
        labelIds.push(l.id);
        strip.push(tok);
      }
    } else {
      strip.push(tok);
    }
  }

  const title = buildTitle(text, strip) || text.trim();
  const args: Record<string, unknown> = { title };

  if (result.startDate) args["start_date"] = result.startDate;
  if (result.deadline) args["deadline"] = result.deadline;
  if (result.evening) args["evening"] = true;
  if (result.priority) args["priority"] = result.priority;
  if (result.recurrence) args["recurrence"] = result.recurrence;
  if (projectId) args["project_id"] = projectId;
  if (labelIds.length) args["label_ids"] = labelIds;

  // View context defaults.
  if (ctx.view.kind === "project" && args["project_id"] === undefined) {
    args["project_id"] = ctx.view.projectId;
  }
  if (ctx.view.kind === "list") {
    if (ctx.view.list === "today" && !args["start_date"] && !args["someday"]) {
      args["start_date"] = ctx.today;
    }
    if (ctx.view.list === "someday") {
      args["someday"] = true;
      delete args["start_date"];
    }
  }

  return args;
}
