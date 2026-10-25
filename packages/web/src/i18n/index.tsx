import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { de } from './de.js';
import { en, type MessageKey } from './en.js';

export type Locale = 'en' | 'de';
export type { MessageKey };

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, de };
const STORAGE_KEY = 's3ndless.locale';

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18n {
  locale: Locale;
  setLocale(locale: Locale): void;
  t: Translate;
}

const I18nContext = createContext<I18n | null>(null);

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'de') return stored;
  } catch {
    // Storage can be unavailable (private mode); fall back to the browser language.
  }
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);
  const t = useCallback<Translate>(
    (key, vars) => {
      const template = DICTIONARIES[locale][key] ?? en[key] ?? key;
      return vars ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`)) : template;
    },
    [locale],
  );
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  document.documentElement.lang = locale;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

export function useT(): Translate {
  return useI18n().t;
}
