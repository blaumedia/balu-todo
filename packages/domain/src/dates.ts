// Calendar-date utilities. Dates are `YYYY-MM-DD` strings interpreted in the
// user's local calendar (contract §0). All arithmetic is done in UTC on the
// date components so it never drifts across DST.

import type { IsoDate } from "./types.js";

/** Today's local calendar date as `YYYY-MM-DD`. */
export function todayLocalISO(now: Date = new Date()): IsoDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toUTC(iso: IsoDate): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): IsoDate {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DAY_MS = 86_400_000;

export function addDaysISO(iso: IsoDate, days: number): IsoDate {
  return fromUTC(toUTC(iso) + days * DAY_MS);
}

export function addMonthsISO(iso: IsoDate, months: number): IsoDate {
  const [y, m, d] = iso.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  // Clamp the day into the target month.
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return fromUTC(Date.UTC(ny, nm, nd));
}

export function addYearsISO(iso: IsoDate, years: number): IsoDate {
  return addMonthsISO(iso, years * 12);
}

/** Whole-day difference `b - a`. */
export function diffDaysISO(a: IsoDate, b: IsoDate): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

/** -1 / 0 / 1 comparison of two `YYYY-MM-DD` strings (lexicographic == chronological). */
export function compareISO(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Day of week, 0 = Sunday … 6 = Saturday. */
export function dowISO(iso: IsoDate): number {
  return new Date(toUTC(iso)).getUTCDay();
}
