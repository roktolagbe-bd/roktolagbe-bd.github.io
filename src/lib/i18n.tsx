import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import bn from '@/locales/bn.json'
import en from '@/locales/en.json'

export type Lang = 'bn' | 'en'

/* Bangla is the default. This is a Bangladeshi site and most people using it in
   an emergency are not reading English. English is the second language, not the
   fallback the code is written around. */
export const DEFAULT_LANG: Lang = 'bn'
const STORAGE_KEY = 'roktolagbe.lang'

/* bn.json is the source of truth for what keys exist. If en.json is missing a
   key, TypeScript says so at build time rather than shipping a blank string. */
type Dict = typeof bn
export type TKey = keyof Dict

const dictionaries: Record<Lang, Dict> = { bn, en: en as Dict }

export type TranslateFn = (key: TKey, vars?: Record<string, string | number>) => string

type I18nValue = {
  lang: Lang
  setLang: (next: Lang) => void
  t: TranslateFn
  /** Formats a number in the digits of the current language. */
  n: (value: number) => string
}

const I18nContext = createContext<I18nValue | null>(null)

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'bn' || stored === 'en') return stored
  } catch {
    /* storage can be blocked in private mode; the default is fine */
  }
  return DEFAULT_LANG
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const

/** 1234 -> "১,২৩৪". Bangla uses the Indian grouping, not thousands. */
export function toBanglaDigits(input: string): string {
  let out = ''
  for (const ch of input) {
    const digit = ch.charCodeAt(0) - 48
    out += digit >= 0 && digit <= 9 ? BN_DIGITS[digit] : ch
  }
  return out
}

export function formatNumber(value: number, lang: Lang): string {
  if (lang === 'bn') {
    return toBanglaDigits(new Intl.NumberFormat('en-IN').format(value))
  }
  return new Intl.NumberFormat('en-US').format(value)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang)

  useEffect(() => {
    const root = document.documentElement
    root.lang = lang
    root.classList.toggle('lang-bn', lang === 'bn')
    root.classList.toggle('lang-en', lang === 'en')
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      /* nothing we can do, and nothing worth telling the user about */
    }
  }, [lang])

  const setLang = useCallback((next: Lang) => setLangState(next), [])

  const t = useCallback<TranslateFn>(
    (key, vars) => {
      const table = dictionaries[lang]
      // Fall back to Bangla rather than to the raw key, so a missing English
      // string still shows something a Bangladeshi reader can use.
      let text: string = table[key] ?? bn[key] ?? key
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          const rendered = typeof value === 'number' ? formatNumber(value, lang) : value
          text = text.replaceAll(`{${name}}`, rendered)
        }
      }
      return text
    },
    [lang],
  )

  const n = useCallback((value: number) => formatNumber(value, lang), [lang])

  const value = useMemo<I18nValue>(() => ({ lang, setLang, t, n }), [lang, setLang, t, n])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
