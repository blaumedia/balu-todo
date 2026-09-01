// Calendar names via `Intl`; the relative-label *logic* is shared with mobile
// through @balu/domain (D3) so the two platforms cannot drift.
import {
  relativeDate as domainRelativeDate,
  relativeTime as domainRelativeTime,
  timestampLabel as domainTimestampLabel,
  type DateNames,
  type DateTone,
  type IsoDate,
  type IsoDateTime,
  type Locale,
  type MetaDateNames,
} from "@balu/domain";
import type { TranslationKey } from "../i18n/index.js";

export type { DateTone };

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

const NAMES: DateNames = { weekdayShort, dayMonth };

/** Human, calm relative label for a date (DESIGN §6). */
export function relativeDate(
  iso: IsoDate,
  today: IsoDate,
  locale: Locale,
  t: (k: TranslationKey) => string,
): { text: string; tone: DateTone } {
  return domainRelativeDate(iso, today, locale, NAMES, {
    today: t("date.today"),
    tomorrow: t("date.tomorrow"),
    yesterday: t("date.yesterday"),
  });
}

/** Calm relative label for a datetime (comment timestamps). */
export function relativeTime(
  iso: IsoDateTime,
  nowMs: number,
  locale: Locale,
  t: (k: TranslationKey) => string,
): string {
  return domainRelativeTime(iso, nowMs, locale, NAMES, t("time.justNow"));
}

// ── Absolute lifecycle timestamps (task detail meta line) ─────────────

/** Absolute date with year, e.g. "Aug 3, 2026" (en) / "3. Aug. 2026" (de). */
export function dateWithYear(iso: IsoDate, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(dateAtNoon(iso));
}

/**
 * Local wall-clock time, "14:05". `hourCycle: "h23"` is pinned on purpose:
 * left to the locale default en-US would print "2:05 PM" while the mobile app
 * prints "14:05", which is exactly the cross-platform drift I7 exists to stop.
 */
export function timeHM(iso: IsoDateTime, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

const META_NAMES: MetaDateNames = { date: dateWithYear, time: timeHM };

/** Absolute label for a task's created / changed / completed timestamp. */
export function timestampLabel(iso: IsoDateTime, nowMs: number, locale: Locale): string {
  return domainTimestampLabel(iso, nowMs, locale, META_NAMES);
}
