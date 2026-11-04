// Turn a parsed quick-add string into `task_add` args (contract §5.4).
//
// Shared by web and mobile — the two apps carried byte-identical copies that
// differed only in how they described "where the user is" (D1). The projects and
// labels are typed structurally, so this module needs no dependency on
// @balu/domain.

import type { ParseResult, Token } from "./types.js";
import { addDays } from "./dateMath.js";
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
  /**
   * The wall clock, used to decide whether a time with no date has already passed today.
   * Defaults to `new Date()`.
   */
  now?: Date;
  /**
   * Local `YYYY-MM-DD` + `HH:MM` -> UTC ISO `reminder_at` (contract §3.3). Defaults to
   * `localTimeToUtc` (runtime timezone); tests inject a fixed offset.
   */
  localToUtc?: (date: string, time: string) => string;
}

function matchByName(
  items: ReadonlyArray<NamedEntity>,
  query: string,
): NamedEntity | undefined {
  const q = query.toLowerCase();
  return items.find((i) => !i.is_deleted && i.name.toLowerCase() === q);
}

/**
 * Local wall time in the runtime timezone -> UTC ISO without milliseconds (the server's own
 * format). Same approach as the apps' ReminderField: a local Date from its components.
 */
export function localTimeToUtc(date: string, time: string): string {
  return new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(time.slice(0, 2)),
    Number(time.slice(3, 5)),
    0,
    0,
  )
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
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

  // A time of day becomes the reminder on the task's own day (contract §3.3).
  if (result.time) {
    const toUtc = opts.localToUtc ?? localTimeToUtc;
    const explicitDate = result.startDate !== undefined || result.deadline !== undefined;
    // Typed dates only: list defaults (Today start, Someday dropping start_date) must not
    // move the reminder off the day the user wrote.
    let day = result.startDate ?? result.deadline ?? (args["start_date"] as string | undefined) ?? opts.today;
    let at = toUtc(day, result.time);
    // "at 9am" typed after 9: the next 9am, not one that fires immediately. The Today-list
    // default start moves with it so the series anchor and the reminder stay on one day.
    if (!explicitDate && Date.parse(at) <= (opts.now ?? new Date()).getTime()) {
      const tomorrow = addDays(opts.today, 1);
      if (args["start_date"] === opts.today) args["start_date"] = tomorrow;
      day = tomorrow;
      at = toUtc(day, result.time);
    }
    args["reminder_at"] = at;
    // "by 5pm" without a date: due that day, reminded at that time. Not with a recurrence:
    // "every monday by 9am" would get a deadline on an unrelated day and the server anchors
    // the series on it, so only the reminder is kept.
    if (result.timeIsDeadline && result.deadline === undefined && !result.recurrence) args["deadline"] = day;
  }

  return args;
}
