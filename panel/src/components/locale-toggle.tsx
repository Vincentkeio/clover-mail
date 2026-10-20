'use client'

import { useI18n } from '@/lib/i18n/client'
import { HTML_LANG, LOCALES, LOCALE_LABEL } from '@/lib/i18n/config'

/**
 * 界面语言切换。放在侧栏导航底部；小屏顶栏用 compact 变体。
 */
export function LocaleToggle({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n()
  return (
    <div className={`locale-switch${compact ? ' is-compact' : ''}`} role="group" aria-label={t('common.language')}>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={HTML_LANG[option]}
          data-locale={option}
          aria-pressed={option === locale}
          className={option === locale ? 'is-active' : undefined}
          onClick={() => setLocale(option)}
        >
          {compact ? (option === 'zh' ? '中' : 'EN') : LOCALE_LABEL[option]}
        </button>
      ))}
    </div>
  )
}
