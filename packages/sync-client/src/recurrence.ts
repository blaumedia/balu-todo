// Client-side next-occurrence for the RRULE subset (contract §3.3). Used by the
// optimistic apply of `task_complete` on recurring tasks; the server remains
// authoritative.

import { addDaysISO, addMonthsISO, addYearsISO, dowISO } from "@balu/domain";

const BYDAY_TO_DOW: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
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
      byday = v.split(",").map((d) => BYDAY_TO_DOW[d]).filter((n) => n != null);
    }
  }
  if (!freq) return null;
  return { freq, interval, byday };
}

function epochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * The next occurrence strictly after `after`, anchored at `anchor`.
 * Returns an ISO date, or null if the rrule is unsupported.
 */
export function nextOccurrence(rrule: string, anchor: string, after: string): string | null {
  const rule = parseRrule(rrule);
  if (!rule) return null;
  const guard = 6000;

  if (rule.freq === "WEEKLY" && rule.byday.length > 0) {
    const anchorMondayEpoch = epochDay(anchor) - ((dowISO(anchor) + 6) % 7);
    let c = anchor <= after ? after : anchor;
    for (let i = 0; i < guard; i++) {
      c = addDaysISO(c, 1);
      if (!rule.byday.includes(dowISO(c))) continue;
      const cMondayEpoch = epochDay(c) - ((dowISO(c) + 6) % 7);
      const weeks = (cMondayEpoch - anchorMondayEpoch) / 7;
      if (weeks % rule.interval === 0) return c;
    }
    return null;
  }

  let c = anchor;
  for (let i = 0; i < guard && c <= after; i++) {
    switch (rule.freq) {
      case "DAILY":
        c = addDaysISO(c, rule.interval);
        break;
      case "WEEKLY":
        c = addDaysISO(c, 7 * rule.interval);
        break;
      case "MONTHLY":
        c = addMonthsISO(c, rule.interval);
        break;
      case "YEARLY":
        c = addYearsISO(c, rule.interval);
        break;
    }
  }
  return c > after ? c : null;
}
