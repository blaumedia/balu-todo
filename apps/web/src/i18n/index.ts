import type { Locale } from "@balu/domain";
import { en, type TranslationKey } from "./en.js";
import { de } from "./de.js";

const DICTS: Record<Locale, Record<TranslationKey, string>> = { en, de };

export type { TranslationKey } from "./en.js";

/** Build a translator bound to a locale. No i18n framework — just typed keys. */
export function makeT(locale: Locale) {
  const dict = DICTS[locale] ?? en;
  return (key: TranslationKey): string => dict[key] ?? en[key] ?? key;
}
