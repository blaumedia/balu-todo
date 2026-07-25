// Calendar names via `Intl`; the relative-label *logic* is shared with mobile
// through @balu/domain (D3) so the two platforms cannot drift.
import {
  relativeDate as domainRelativeDate,
  relativeTime as domainRelativeTime,
  type DateNames,
  type DateTone,
  type IsoDate,
  type IsoDateTime,
  type Locale,
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
