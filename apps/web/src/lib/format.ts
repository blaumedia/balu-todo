import { addDaysISO, compareISO, diffDaysISO, type IsoDate, type IsoDateTime, type Locale } from "@balu/domain";
import type { TranslationKey } from "../i18n/index.js";

export type DateTone = "today" | "overdue" | "future";

function localeTag(locale: Locale): string {
  return locale === "de" ? "de-DE" : "en-US";
}

// Build a Date at UTC noon so Intl formatting never shifts the calendar day.
function dateAtNoon(iso: IsoDate): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function weekdayShort(iso: IsoDate, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), { weekday: "short", timeZone: "UTC" }).format(dateAtNoon(iso));
}

export function weekdayLong(iso: IsoDate, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), { weekday: "long", timeZone: "UTC" }).format(dateAtNoon(iso));
}

export function dayMonth(iso: IsoDate, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), { day: "numeric", month: "short", timeZone: "UTC" }).format(dateAtNoon(iso));
}

export function monthLong(iso: IsoDate, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), { month: "long", year: "numeric", timeZone: "UTC" }).format(dateAtNoon(iso));
}

/** Human, calm relative label for a date (DESIGN §6). */
export function relativeDate(
  iso: IsoDate,
  today: IsoDate,
  locale: Locale,
  t: (k: TranslationKey) => string,
): { text: string; tone: DateTone } {
  const cmp = compareISO(iso, today);
  if (cmp === 0) return { text: t("date.today"), tone: "today" };
  if (iso === addDaysISO(today, 1)) return { text: t("date.tomorrow"), tone: "future" };
  if (cmp < 0) {
    // Overdue: yesterday gets a word, otherwise the date.
    if (iso === addDaysISO(today, -1)) return { text: t("date.yesterday"), tone: "overdue" };
    return { text: dayMonth(iso, locale), tone: "overdue" };
  }
  const ahead = diffDaysISO(today, iso);
  if (ahead < 7) return { text: weekdayShort(iso, locale), tone: "future" };
  return { text: dayMonth(iso, locale), tone: "future" };
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** Calm relative label for a datetime (comment timestamps). */
export function relativeTime(
  iso: IsoDateTime,
  nowMs: number,
  locale: Locale,
  t: (k: TranslationKey) => string,
): string {
  const diffSec = Math.round((new Date(iso).getTime() - nowMs) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return t("time.justNow");
  const rtf = new Intl.RelativeTimeFormat(localeTag(locale), { numeric: "auto" });
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs) return rtf.format(Math.round(diffSec / secs), unit);
  }
  return t("time.justNow");
}
