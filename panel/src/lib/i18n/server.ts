import { cookies } from 'next/headers'
import { LOCALE_COOKIE, normalizeLocale, type Locale } from './config'
import { createTranslator, type Translator } from './translate'

/** 服务端组件读取当前界面语言。 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies()
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value)
}

/**
 * API 路由读取当前界面语言。
 * 从请求对象直接取 cookie，避免把原本可静态化的 GET 路由拖成动态渲染。
 */
export function requestLocale(request: { cookies: { get(name: string): { value: string } | undefined } }): Locale {
  return normalizeLocale(request.cookies.get(LOCALE_COOKIE)?.value)
}

/** 服务端组件里的一次性取用：`const { locale, t } = await getI18n()`。 */
export async function getI18n(): Promise<{ locale: Locale; t: Translator }> {
  const locale = await getLocale()
  return { locale, t: createTranslator(locale) }
}

/** API 路由/服务端工具里只要翻译函数：`const t = await getTranslator()`。 */
export async function getTranslator(): Promise<Translator> {
  return createTranslator(await getLocale())
}
