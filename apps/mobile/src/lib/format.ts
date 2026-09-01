// Manual calendar-name tables per locale instead of Intl.DateTimeFormat —
// Hermes' Intl timezone support is uneven across platforms, and we only need
// de/en. The relative-label *logic* is shared with the web app through
// @balu/domain (D3), so only the names differ between platforms.
import {
  dowISO,
  relativeDate as domainRelativeDate,
  relativeTime as domainRelativeTime,
  timestampLabel as domainTimestampLabel,
  type DateNames,
  type DateTone,
  type IsoDate,
  type IsoDateTime,
  type Locale,
  type MetaDateNames,
} from '@balu/domain';
import type { TranslationKey } from '../i18n';

export type { DateTone };

const WEEKDAY_SHORT: Record<Locale, string[]> = {
  // index 0 = Sunday … 6 = Saturday (matches dowISO)
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
};
const WEEKDAY_LONG: Record<Locale, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
};
const MONTH_SHORT: Record<Locale, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  de: ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'],
};
const MONTH_LONG: Record<Locale, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
};

function parts(iso: IsoDate): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function weekdayShort(iso: IsoDate, locale: Locale): string {
  return WEEKDAY_SHORT[locale][dowISO(iso)];
}

export function weekdayLong(iso: IsoDate, locale: Locale): string {
  return WEEKDAY_LONG[locale][dowISO(iso)];
}

/** e.g. "31 Jul" (en) / "31. Juli" (de). */
export function dayMonth(iso: IsoDate, locale: Locale): string {
  const { m, d } = parts(iso);
  const month = MONTH_SHORT[locale][m - 1];
  return locale === 'de' ? `${d}. ${month}` : `${d} ${month}`;
}

/** e.g. "July 2026" / "Juli 2026". */
export function monthLong(iso: IsoDate, locale: Locale): string {
  const { y, m } = parts(iso);
  return `${MONTH_LONG[locale][m - 1]} ${y}`;
}

const NAMES: DateNames = { weekdayShort, dayMonth };

/**
 * Compact relative label for a past timestamp (comment meta). Under a minute
 * → "just now"; then Xm / Xh / Xd; beyond a week falls back to the date.
 */
export function relativeTime(
  iso: IsoDateTime,
  nowMs: number,
  locale: Locale,
  t: (k: TranslationKey) => string,
): string {
  return domainRelativeTime(iso, nowMs, locale, NAMES, t('time.justNow'));
}

/** Human, calm relative label for a date (DESIGN §6). */
export function relativeDate(
  iso: IsoDate,
  today: IsoDate,
  locale: Locale,
  t: (k: TranslationKey) => string,
): { text: string; tone: DateTone } {
  return domainRelativeDate(iso, today, locale, NAMES, {
    today: t('date.today'),
    tomorrow: t('date.tomorrow'),
    yesterday: t('date.yesterday'),
  });
}

/** Absolute date with year, e.g. "Aug 3, 2026" (en) / "3. Aug. 2026" (de). */
export function dateWithYear(iso: IsoDate, locale: Locale): string {
  const { y, m, d } = parts(iso);
  const month = MONTH_SHORT[locale][m - 1];
  return locale === 'de' ? `${d}. ${month} ${y}` : `${month} ${d}, ${y}`;
}

/** Local wall-clock time, 24h, e.g. "14:05". Matches the web app (I7); no Intl here. */
export function timeHM(iso: IsoDateTime): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const META_NAMES: MetaDateNames = { date: dateWithYear, time: timeHM };

/** Absolute label for a task's created / changed / completed timestamp. */
export function timestampLabel(iso: IsoDateTime, nowMs: number, locale: Locale): string {
  return domainTimestampLabel(iso, nowMs, locale, META_NAMES);
}
