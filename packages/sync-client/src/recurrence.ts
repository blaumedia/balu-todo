// Client-side next-occurrence for the RRULE subset (contract §3.3). Used by the
// optimistic apply of `task_complete` on recurring tasks; the server remains
// authoritative — and must agree, so this file mirrors
// `server/balu/sync/recurrence.py` step for step.

import { addDaysISO, addMonthsISO, addYearsISO, diffDaysISO, dowISO } from "@balu/domain";

/** BYDAY code → offset from Monday (WKST=MO), matching the server's _WEEKDAYS. */
const BYDAY_TO_OFFSET: Record<string, number> = {
  MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6,
};

interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  /** Offsets from the week's Monday, ascending. */
  byday: number[];
}

export function parseRrule(rrule: string): Rule | null {
  const parts = rrule.split(";");
  let freq: Rule["freq"] | null = null;
  let interval = 1;
  let byday: number[] = [];
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "FREQ" && (v === "DAILY" || v === "WEEKLY" || v === "MONTHLY" || v === "YEARLY")) {
      freq = v;
    } else if (k === "INTERVAL") {
      interval = Math.max(1, Number(v) || 1);
    } else if (k === "BYDAY") {
      byday = v.split(",").map((d) => BYDAY_TO_OFFSET[d]).filter((n) => n != null);
    }
  }
  if (!freq) return null;
  // BYDAY is only meaningful with FREQ=WEEKLY (§3.3), and the server iterates it
  // in ascending order — match both so the two engines cannot diverge.
  if (freq !== "WEEKLY") byday = [];
  byday = [...new Set(byday)].sort((a, b) => a - b);
  return { freq, interval, byday };
}

/** The Monday of `iso`'s week (WKST=MO). */
function mondayOf(iso: string): string {
  return addDaysISO(iso, -((dowISO(iso) + 6) % 7));
}

function year(iso: string): number {
  return Number(iso.slice(0, 4));
}
function month(iso: string): number {
  return Number(iso.slice(5, 7));
}

/**
 * The k-th member of the series, always measured from `anchor`. Measuring from
 * the anchor (rather than from the previous occurrence) is what keeps month-end
 * rules stable: Jan 31 → Feb 28 → Mar 31, not Mar 28.
 */
function nth(anchor: string, rule: Rule, k: number): string {
  switch (rule.freq) {
    case "DAILY":
      return addDaysISO(anchor, rule.interval * k);
    case "WEEKLY":
      return addDaysISO(anchor, 7 * rule.interval * k);
    case "MONTHLY":
      return addMonthsISO(anchor, rule.interval * k);
    case "YEARLY":
      return addYearsISO(anchor, rule.interval * k);
  }
}

/** A lower bound for the answer's index — never overshoots it. */
function startK(anchor: string, rule: Rule, after: string): number {
  if (after <= anchor) return 0;
  switch (rule.freq) {
    case "DAILY":
      return Math.max(0, Math.floor(diffDaysISO(anchor, after) / rule.interval));
    case "WEEKLY":
      return Math.max(0, Math.floor(diffDaysISO(anchor, after) / (7 * rule.interval)));
    case "MONTHLY": {
      const months = (year(after) - year(anchor)) * 12 + (month(after) - month(anchor));
      return Math.max(0, Math.floor(months / rule.interval));
    }
    case "YEARLY":
      return Math.max(0, Math.floor((year(after) - year(anchor)) / rule.interval));
  }
}

const SCAN_LIMIT = 64;

/**
 * The next occurrence of the series anchored at `anchor`, strictly after
 * `after`. The series is `anchor, anchor+interval, anchor+2·interval, …` — for
 * `FREQ=WEEKLY` with `BYDAY`, the BYDAY days of every `interval`-th week
 * starting from the anchor's own week.
 *
 * Returns an ISO date, or null if the rrule is unsupported.
 */
export function nextOccurrence(rrule: string, anchor: string, after: string): string | null {
  const rule = parseRrule(rrule);
  if (!rule) return null;

  if (rule.freq === "WEEKLY" && rule.byday.length > 0) {
    const monday = mondayOf(anchor);
    const span = diffDaysISO(monday, after);
    const first = span > 0 ? Math.max(0, Math.floor(span / (7 * rule.interval))) : 0;
    for (let k = first; k < first + SCAN_LIMIT; k += 1) {
      const week = addDaysISO(monday, 7 * rule.interval * k);
      for (const weekday of rule.byday) {
        const candidate = addDaysISO(week, weekday);
        if (candidate > after) return candidate;
      }
    }
    return null;
  }

  const first = startK(anchor, rule, after);
  for (let k = first; k < first + SCAN_LIMIT; k += 1) {
    const candidate = nth(anchor, rule, k);
    if (candidate > after) return candidate;
  }
  return null;
}

/** Clamp for `task_complete`'s `utc_offset`, mirroring the server's MIN/MAX_UTC_OFFSET. */
const MIN_UTC_OFFSET = -12 * 60;
const MAX_UTC_OFFSET = 14 * 60;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/**
 * `args.utc_offset` -> minutes east of UTC, or 0 when absent, not an integer or out of range.
 * Mirrors `utc_offset_minutes` in `server/balu/sync/recurrence.py`.
 */
export function utcOffsetMinutes(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_UTC_OFFSET && value <= MAX_UTC_OFFSET
    ? value
    : 0;
}

export interface Rolled {
  start_date: string | null;
  deadline: string | null;
  reminder_at: string | null;
}

/** Shift a UTC instant by whole days, in the server's `YYYY-MM-DDTHH:MM:SSZ` format. */
function shiftInstant(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Advance a recurring task on completion (contract §3.3). Mirrors `roll_forward` in
 * `server/balu/sync/recurrence.py` step for step; returns null when the rrule is unsupported
 * (the caller then leaves the task alone, as before).
 */
export function rollForward(
  rrule: string,
  startDate: string | null,
  deadline: string | null,
  reminderAt: string | null,
  today: string,
  utcOffset = 0,
): Rolled | null {
  let start = startDate;
  let due = deadline;
  let shift = 0;
  if (start != null) {
    const next = nextOccurrence(rrule, start, start > today ? start : today);
    if (!next) return null;
    shift = diffDaysISO(start, next);
    start = next;
    if (due != null) due = addDaysISO(due, shift);
  } else if (due != null) {
    const next = nextOccurrence(rrule, due, due > today ? due : today);
    if (!next) return null;
    shift = diffDaysISO(due, next);
    due = next;
  } else {
    const next = nextOccurrence(rrule, today, today);
    if (!next) return null;
    start = next;
    const ms = reminderAt == null ? NaN : Date.parse(reminderAt);
    if (!Number.isNaN(ms)) {
      const localDay = new Date(ms + utcOffset * MINUTE_MS).toISOString().slice(0, 10);
      shift = diffDaysISO(localDay, next);
    }
  }
  let reminder = reminderAt;
  if (reminder != null && shift > 0 && !Number.isNaN(Date.parse(reminder))) {
    const shifted = shiftInstant(reminder, shift);
    // Past year 9999 the ISO string is not a valid server instant: leave the reminder alone.
    if (/^\d{4}-/.test(shifted)) reminder = shifted;
  }
  return { start_date: start, deadline: due, reminder_at: reminder };
}
