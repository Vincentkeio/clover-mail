import { DEFAULT_LOCALE, type Locale } from './config'
import { en } from './messages/en'
import { zh } from './messages/zh'
import type { MessageKey, Messages } from './types'

export type { MessageKey, Messages }

export type TranslateVars = Record<string, string | number>

export const messages: Record<Locale, Messages> = { en, zh }

const PLACEHOLDER = /\{(\w+)\}/g

function format(template: string, vars?: TranslateVars): string {
  if (!vars) return template
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

export type Translator = (key: MessageKey, vars?: TranslateVars) => string

/** 取某个命名空间下的键值；找不到时返回 undefined，由调用方回退。 */
function lookup(table: Messages, key: string): string | undefined {
  const separator = key.indexOf('.')
  if (separator === -1) return undefined
  const namespace = key.slice(0, separator) as keyof Messages
  const name = key.slice(separator + 1)
  return (table[namespace] as Record<string, string> | undefined)?.[name]
}

/** 生成某语言的翻译函数；该语言缺失的键回退到默认语言。 */
export function createTranslator(locale: Locale): Translator {
  const table = messages[locale] ?? messages[DEFAULT_LOCALE]
  const fallback = messages[DEFAULT_LOCALE]
  return (key, vars) => format(lookup(table, key) ?? lookup(fallback, key) ?? key, vars)
}
