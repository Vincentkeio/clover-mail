/** 面板界面语言。中文用 zh，英文用 en。 */
export const LOCALES = ['en', 'zh'] as const
export type Locale = (typeof LOCALES)[number]

/** 未选择过语言时使用的界面语言。 */
export const DEFAULT_LOCALE: Locale = 'en'

/** 语言偏好存 cookie，服务端组件与 API 路由都用它决定渲染语言。 */
export const LOCALE_COOKIE = 'clover_locale'

/** 一年，够长到不会在常规使用中过期。 */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function normalizeLocale(value: string | undefined | null): Locale {
  return value === 'zh' ? 'zh' : DEFAULT_LOCALE
}

/** <html lang> 用完整的 BCP 47 标签。 */
export const HTML_LANG: Record<Locale, string> = { en: 'en', zh: 'zh-CN' }

/** 日期时间格式化用的区域标签。 */
export const DATE_LOCALE: Record<Locale, string> = { en: 'en-US', zh: 'zh-CN' }

/** 语言切换按钮上显示的短标签。 */
export const LOCALE_LABEL: Record<Locale, string> = { en: 'EN', zh: '中文' }
