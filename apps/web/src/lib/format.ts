import { addDaysISO, compareISO, diffDaysISO, type IsoDate, type Locale } from "@balu/domain";
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
