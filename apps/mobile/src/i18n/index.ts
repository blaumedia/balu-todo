import type { Locale } from '@balu/domain';
import { useMemo } from 'react';
import { useApp } from '../store/app';
import { de } from './de';
import { en, type TranslationKey } from './en';

const DICTS: Record<Locale, Record<TranslationKey, string>> = { en, de };

export type { TranslationKey } from './en';

/** Build a translator bound to a locale. No i18n framework — just typed keys. */
export function makeT(locale: Locale) {
  const dict = DICTS[locale] ?? en;
  return (key: TranslationKey): string => dict[key] ?? en[key] ?? key;
}

/** Hook: current translator + locale, bound to the app store. */
export function useT(): { t: (k: TranslationKey) => string; locale: Locale } {
  const locale = useApp((s) => s.locale);
  return useMemo(() => ({ t: makeT(locale), locale }), [locale]);
}
