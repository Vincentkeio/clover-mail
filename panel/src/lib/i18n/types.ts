import { zh } from './messages/zh'

/** 中文词条是唯一的键定义来源；英文词条按同一结构强制对齐。 */
export type Messages = typeof zh

/** 所有可用的词条键，写法为 `<命名空间>.<键>`。 */
export type MessageKey = {
  [Namespace in keyof Messages & string]: `${Namespace}.${keyof Messages[Namespace] & string}`
}[keyof Messages & string]
