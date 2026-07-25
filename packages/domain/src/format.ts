// Calm relative date/time labels (DESIGN §6).
//
// The *logic* is shared; how calendar names are produced is injected, because
// mobile deliberately avoids `Intl` (Hermes' timezone support is uneven) while
// web uses `Intl.DateTimeFormat` (D3).

import { addDaysISO, compareISO, diffDaysISO } from "./dates.js";
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
