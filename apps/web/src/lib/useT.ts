import { useMemo } from "react";
import type { Locale } from "@balu/domain";
import { makeT, type TranslationKey } from "../i18n/index.js";
import { useApp } from "../store/app.js";

export function useT(): { t: (k: TranslationKey) => string; locale: Locale } {
  const locale = useApp((s) => s.locale);
  return useMemo(() => ({ t: makeT(locale), locale }), [locale]);
}
