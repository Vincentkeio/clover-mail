import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { DEFAULT_LOCALE } from '@/lib/i18n/config'
import { createTranslator, type Translator } from '@/lib/i18n/translate'

/** 调用方未传 Translator 时的兜底（默认语言），避免漏改调用点时丢文案。 */
const fallbackTranslator = createTranslator(DEFAULT_LOCALE)

/** 邮箱格式校验；提示文案跟随传入的 Translator。 */
function emailSchemaFor(t: Translator) {
  return z.string().trim().toLowerCase().max(254).email(t('apiAuth.validation.emailFormat'))
}

/** Both API representations must produce the same validated address array. */
function forwardingTargetsSchema(t: Translator = fallbackTranslator) {
  return z.union([z.array(z.string()), z.string().max(65536)])
    .transform((value) => Array.isArray(value) ? value : value.split(',').map((item) => item.trim()).filter(Boolean))
    .pipe(z.array(emailSchemaFor(t)).min(1, t('apiAuth.validation.targetRequired')).max(100))
}

// 以下模块级常量 schema 供清单外调用点直接使用，提示文案取默认语言。
/** 域名：小写、点分标签，label 不以连字符开头/结尾 */
export const domainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    fallbackTranslator('apiAuth.validation.domainFormat'),
  )
  .max(253)

const mailHostnameSchema = domainNameSchema

export const emailSchema = emailSchemaFor(fallbackTranslator)

export const createDomainSchema = z.object({
  name: domainNameSchema,
  mailHostname: mailHostnameSchema.optional(),
  quotaPolicyMb: z.coerce.number().int().min(0).max(1024 * 1024).optional(),
})

export const updateDomainSchema = z.object({
  mailHostname: mailHostnameSchema.optional(),
  quotaPolicyMb: z.coerce.number().int().min(0).max(1024 * 1024).optional(),
  active: z.boolean().optional(),
})

export const createMailboxSchema = z.object({
  login: emailSchema,
  password: z.string().min(10, fallbackTranslator('apiAuth.validation.passwordMin')).max(128),
  quotaMb: z.coerce.number().int().min(0).max(1024 * 1024).optional(),
})

/** 提示文案跟随传入的 Translator（清单外调用点不传时用默认语言）。 */
export function updateMailboxSchema(t: Translator = fallbackTranslator) {
  return z
    .object({
      password: z.string().min(10).max(128).optional(),
      quotaMb: z.coerce.number().int().min(0).max(1024 * 1024).optional(),
      active: z.boolean().optional(),
    })
    .refine((d) => Object.keys(d).length > 0, t('apiAuth.validation.nothingToUpdate'))
}

export const matchTypeSchema = z.enum(['exact', 'prefix', 'nonuser', 'catchall'])

export const createRuleSchema = z
  .object({
    matchType: matchTypeSchema,
    matchValue: z.string().trim().toLowerCase().max(253).optional(),
    /** 逗号分隔字符串或数组都接受 */
    targets: forwardingTargetsSchema(),
    priority: z.coerce.number().int().min(0).max(10000).default(100),
    active: z.boolean().default(true),
  })
  .refine(
    (rule) => {
      if (rule.matchType === 'exact' || rule.matchType === 'nonuser') {
        return !!rule.matchValue && emailSchema.safeParse(rule.matchValue).success
      }
      if (rule.matchType === 'prefix') {
        return !!rule.matchValue && /^[a-z0-9!#$%&'*+\-/=?^_`{|}~.]{1,64}$/.test(rule.matchValue)
      }
      return !rule.matchValue // catchall 不需要 matchValue
    },
    {
      message: fallbackTranslator('apiAuth.validation.ruleMatch'),
    },
  )

/** 提示文案跟随传入的 Translator（清单外调用点不传时用默认语言）。 */
export function updateRuleSchema(t: Translator = fallbackTranslator) {
  return z.object({
    targets: forwardingTargetsSchema(t).optional(),
    priority: z.coerce.number().int().min(0).max(10000).optional(),
    active: z.boolean().optional(),
  }).refine((value) => Object.keys(value).length > 0, t('apiAuth.validation.nothingToUpdate'))
}

export const settingsPatchSchema = z.object({
  vpsIp: z.string().ip({ version: 'v4' }).optional(),
  dnsMode: z.enum(['cloudflare', 'manual']).optional(),
  cfApiToken: z.string().trim().min(1).max(4096).optional(),
  dmarcPolicy: z.enum(['none', 'quarantine', 'reject']).optional(),
  spfStrict: z.boolean().optional(),
  advancedDns: z.boolean().optional(),
  allowImap: z.boolean().optional(),
  allowPop3: z.boolean().optional(),
  allowSieve: z.boolean().optional(),
  allowSmtp: z.boolean().optional(),
  allowExternalImages: z.boolean().optional(),
  maxAttachmentMb: z.number().int().min(0).max(102400).optional(),
}).refine((value) => Object.keys(value).length > 0, fallbackTranslator('apiAuth.validation.nothingToUpdate'))

export function newOwnershipToken(): string {
  return `clover-verification=${randomBytes(8).toString('hex')}`
}
