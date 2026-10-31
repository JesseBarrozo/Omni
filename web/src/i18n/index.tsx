// React layer for i18n. Wrap the app in <I18nProvider> and read strings with
// useTranslation()'s t(key, params?). The chosen locale is kept per browser in
// localStorage; it falls back to the browser language, then French.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  DEFAULT_LOCALE,
  LOCALES,
  makeTranslate,
  resolveLocale,
  type Locale,
  type Params,
} from "./catalog";
import { fr, type MessageKey } from "./fr";
import { en } from "./en";
import { es } from "./es";

const CATALOGS = { fr, en, es } as const;
const STORAGE_KEY = "omni.locale";

export type Translate = (key: MessageKey, params?: Params) => string;

type I18nValue = { locale: Locale; setLocale: (locale: Locale) => void; t: Translate };

const I18nContext = createContext<I18nValue | null>(null);

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return resolveLocale(stored);
  } catch {
    // Private windows or blocked storage: fall through to the browser language.
  }
  return resolveLocale(typeof navigator !== "undefined" ? navigator.language : DEFAULT_LOCALE);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Ignore: the locale still applies for this session.
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: makeTranslate(CATALOGS[locale], fr, locale) }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useTranslation must be used within I18nProvider.");
  return value;
}

export { LOCALES };
export type { Locale };
