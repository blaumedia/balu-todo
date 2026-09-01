// Calm relative date/time labels (DESIGN §6).
//
// The *logic* is shared; how calendar names are produced is injected, because
// mobile deliberately avoids `Intl` (Hermes' timezone support is uneven) while
// web uses `Intl.DateTimeFormat` (D3).

import { addDaysISO, compareISO, diffDaysISO, todayLocalISO } from "./dates.js";
import type { IsoDate, IsoDateTime, Locale } from "./types.js";

export type DateTone = "today" | "overdue" | "future";

/** Platform-provided calendar names. */
export interface DateNames {
  weekdayShort(iso: IsoDate, locale: Locale): string;
  /** e.g. "31 Jul" (en) / "31. Juli" (de). */
  dayMonth(iso: IsoDate, locale: Locale): string;
}

export interface RelativeDateLabels {
  today: string;
  tomorrow: string;
  yesterday: string;
}

/** Human, calm relative label for a calendar date. */
export function relativeDate(
  iso: IsoDate,
  today: IsoDate,
  locale: Locale,
  names: DateNames,
  labels: RelativeDateLabels,
): { text: string; tone: DateTone } {
  const cmp = compareISO(iso, today);
  if (cmp === 0) return { text: labels.today, tone: "today" };
  if (iso === addDaysISO(today, 1)) return { text: labels.tomorrow, tone: "future" };
  if (cmp < 0) {
    // Overdue: yesterday gets a word, otherwise the date.
    if (iso === addDaysISO(today, -1)) return { text: labels.yesterday, tone: "overdue" };
    return { text: names.dayMonth(iso, locale), tone: "overdue" };
  }
  const ahead = diffDaysISO(today, iso);
  if (ahead < 7) return { text: names.weekdayShort(iso, locale), tone: "future" };
  return { text: names.dayMonth(iso, locale), tone: "future" };
}

/**
 * Compact relative label for a past timestamp (comment meta). Under a minute →
 * `justNow`; then Xm / Xh / Xd; beyond a week the date.
 *
 * One presentation on every platform (I7): web used `Intl.RelativeTimeFormat`
 * ("2 hours ago") while mobile produced "2h", so the same comment read
 * differently depending on where you opened it.
 */
export function relativeTime(
  iso: IsoDateTime,
  nowMs: number,
  locale: Locale,
  names: DateNames,
  justNow: string,
): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const sec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (sec < 60) return justNow;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return names.dayMonth(iso.slice(0, 10) as IsoDate, locale);
}

/**
 * Platform-provided names for absolute lifecycle timestamps. Injected for the
 * same reason as `DateNames`: web formats with `Intl`, mobile with tables (D3).
 */
export interface MetaDateNames {
  /** Absolute calendar date with year, e.g. "Aug 3, 2026" / "3. Aug. 2026". */
  date(iso: IsoDate, locale: Locale): string;
  /** Local wall-clock time, 24h `HH:MM`, e.g. "14:05". */
  time(iso: IsoDateTime, locale: Locale): string;
}

/**
 * Absolute label for a task's created / changed / completed timestamp.
 *
 * Deliberately not `relativeTime`: the created date is a fact worth reading
 * years later, and the clock is only the informative part when it happened
 * today - so older entries stay at date width and today's get "14:05".
 *
 * The calendar day comes from the *local* day of the instant (via
 * `todayLocalISO`), never from `iso.slice(0, 10)` - the wire value is UTC and
 * slicing it would show yesterday's date to a user just after local midnight.
 */
export function timestampLabel(
  iso: IsoDateTime,
  nowMs: number,
  locale: Locale,
  names: MetaDateNames,
): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const day = todayLocalISO(new Date(then));
  if (day === todayLocalISO(new Date(nowMs))) {
    return `${names.date(day, locale)}, ${names.time(iso, locale)}`;
  }
  return names.date(day, locale);
}
