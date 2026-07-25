// Turn a parsed quick-add string into `task_add` args (contract §5.4).
//
// Shared by web and mobile — the two apps carried byte-identical copies that
// differed only in how they described "where the user is" (D1). The projects and
// labels are typed structurally, so this module needs no dependency on
// @balu/domain.

import type { ParseResult, Token } from "./types.js";
import { buildTitle } from "./title.js";

/** Anything with a display name the parser can match `#project` / `@label` against. */
export interface NamedEntity {
  id: string;
  name: string;
  is_deleted: boolean;
}

/**
 * Where the new task is being created — the app's own view/route mapped onto the
 * only two things that affect the outcome.
 */
export type ComposeContext =
  | { kind: "project"; projectId: string }
  | { kind: "list"; list: string }
  | { kind: "none" };

export interface ComposeOptions {
  projects: ReadonlyArray<NamedEntity>;
  labels: ReadonlyArray<NamedEntity>;
  /** `YYYY-MM-DD` used when the context implies "today". */
  today: string;
  context: ComposeContext;
}

function matchByName(
  items: ReadonlyArray<NamedEntity>,
  query: string,
): NamedEntity | undefined {
  const q = query.toLowerCase();
  return items.find((i) => !i.is_deleted && i.name.toLowerCase() === q);
}

/**
 * Only *existing* projects/labels match; unmatched `#`/`@` tokens stay as literal
 * title text.
 */
export function composeTaskArgs(
  text: string,
  result: ParseResult,
  opts: ComposeOptions,
): Record<string, unknown> {
  let projectId: string | undefined;
  const labelIds: string[] = [];
  const strip: Token[] = [];

  for (const tok of result.tokens) {
    if (tok.type === "project") {
      const p = matchByName(opts.projects, String(tok.value));
      if (p) {
        if (!projectId) projectId = p.id;
        strip.push(tok);
      }
    } else if (tok.type === "label") {
      const l = matchByName(opts.labels, String(tok.value));
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

  // Context defaults — an explicit token in the text always wins.
  const ctx = opts.context;
  if (ctx.kind === "project" && args["project_id"] === undefined) {
    args["project_id"] = ctx.projectId;
  }
  if (ctx.kind === "list") {
    if (ctx.list === "today" && !args["start_date"] && !args["someday"]) {
      args["start_date"] = opts.today;
    }
    if (ctx.list === "someday") {
      args["someday"] = true;
      delete args["start_date"];
    }
  }

  return args;
}
