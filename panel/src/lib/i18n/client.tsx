'use client'

import { createContext, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { DATE_LOCALE, HTML_LANG, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from './config'
import { createTranslator, type Translator } from './translate'

type LocaleValue = {
  locale: Locale
  t: Translator
  /** 日期时间格式化用的区域标签。 */
  dateLocale: string
  setLocale: (next: Locale) => void
}

const LocaleContext = createContext<LocaleValue | null>(null)

export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const router = useRouter()
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [, startTransition] = useTransition()

  // 服务端渲染结果到达后同步，保证刷新/前进后退时语言一致。
  useEffect(() => { setLocaleState(initialLocale) }, [initialLocale])
  useEffect(() => { document.documentElement.lang = HTML_LANG[locale] }, [locale])

  const value = useMemo<LocaleValue>(() => ({
    locale,
    t: createTranslator(locale),
    dateLocale: DATE_LOCALE[locale],
    setLocale: (next) => {
      setLocaleState(next)
      const secure = location.protocol === 'https:' ? ';secure' : ''
      document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=${LOCALE_COOKIE_MAX_AGE};samesite=lax${secure}`
      // 服务端组件（总览、API 文档等）按 cookie 渲染，需重新拉取。
      startTransition(() => router.refresh())
    },
  }), [locale, router])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useI18n(): LocaleValue {
  const value = useContext(LocaleContext)
  if (!value) throw new Error('useI18n 必须在 LocaleProvider 内使用')
  return value
}
