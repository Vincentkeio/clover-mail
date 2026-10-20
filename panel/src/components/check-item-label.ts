import type { Translator } from '@/lib/i18n/translate'
import type { MessageKey } from '@/lib/i18n/types'

/** 检测项的最小结构：服务端把 label 一起存了下来。 */
export type CheckItemRef = { key: string; label: string }

/**
 * DNS 检测项的 label 跟着检测结果一起存在服务端，是**检测当时**的语言。
 * 渲染时按 key 重新取词条，标签才能跟随当前界面语言；
 * 取不到词条（新增检测项但还没补词条）时回退到存储文案。
 */
export function checkItemLabel(item: CheckItemRef, t: Translator): string {
  const key = `dns.checkItem.${item.key}` as MessageKey
  const label = t(key)
  return label === key ? item.label : label
}
