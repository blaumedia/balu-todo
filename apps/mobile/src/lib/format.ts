// Calm relative date labels (DESIGN §6). Manual name tables per locale instead
// of Intl.DateTimeFormat — Hermes' Intl timezone support is uneven across
// platforms, and we only need de/en.
import { addDaysISO, compareISO, diffDaysISO, dowISO, type IsoDate, type Locale } from '@balu/domain';
import type { TranslationKey } from '../i18n';

export type DateTone = 'today' | 'overdue' | 'future';

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

/** Human, calm relative label for a date (DESIGN §6). */
export function relativeDate(
  iso: IsoDate,
  today: IsoDate,
  locale: Locale,
  t: (k: TranslationKey) => string,
): { text: string; tone: DateTone } {
  const cmp = compareISO(iso, today);
  if (cmp === 0) return { text: t('date.today'), tone: 'today' };
  if (iso === addDaysISO(today, 1)) return { text: t('date.tomorrow'), tone: 'future' };
  if (cmp < 0) {
    if (iso === addDaysISO(today, -1)) return { text: t('date.yesterday'), tone: 'overdue' };
    return { text: dayMonth(iso, locale), tone: 'overdue' };
  }
  const ahead = diffDaysISO(today, iso);
  if (ahead < 7) return { text: weekdayShort(iso, locale), tone: 'future' };
  return { text: dayMonth(iso, locale), tone: 'future' };
}
