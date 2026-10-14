import { randomBytes } from 'node:crypto'
import { z } from 'zod'

/** 域名：小写、点分标签，label 不以连字符开头/结尾 */
export const domainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    '域名格式不正确',
  )
  .max(253)

export const emailSchema = z.string().trim().toLowerCase().email('邮箱格式不正确')

export const createDomainSchema = z.object({
  name: domainNameSchema,
  mailHostname: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/)
    .max(253)
    .optional(),
  quotaPolicyMb: z.coerce.number().int().min(0).max(1024 * 1024).optional(),
})

export const updateDomainSchema = z.object({
  mailHostname: z.string().trim().toLowerCase().max(253).optional(),
  quotaPolicyMb: z.coerce.number().int().min(0).max(1024 * 1024).optional(),
  active: z.boolean().optional(),
})

export const createMailboxSchema = z.object({
  login: emailSchema,
  password: z.string().min(10, '密码至少 10 位').max(128),
  quotaMb: z.coerce.number().int().min(0).max(1024 * 1024).optional(),
})

export const updateMailboxSchema = z
  .object({
    password: z.string().min(10).max(128).optional(),
    quotaMb: z.coerce.number().int().min(0).max(1024 * 1024).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, '没有需要更新的字段')

export const matchTypeSchema = z.enum(['exact', 'prefix', 'nonuser', 'catchall'])

export const createRuleSchema = z
  .object({
    matchType: matchTypeSchema,
    matchValue: z.string().trim().toLowerCase().max(253).optional(),
    /** 逗号分隔字符串或数组都接受 */
    targets: z.union([z.array(emailSchema), z.string()]).transform((v, ctx) => {
      const list = Array.isArray(v) ? v : v.split(',').map((s) => s.trim()).filter(Boolean)
      if (list.length === 0) ctx.addIssue({ code: 'custom', message: '至少一个转发目标' })
      return list
    }),
    priority: z.coerce.number().int().min(0).max(10000).default(100),
    active: z.boolean().default(true),
  })
  .refine(
    (rule) => {
      if (rule.matchType === 'exact' || rule.matchType === 'nonuser') {
        return !!rule.matchValue && emailSchema.safeParse(rule.matchValue).success
      }
      if (rule.matchType === 'prefix') {
        return !!rule.matchValue && /^[^@\s]{1,64}$/.test(rule.matchValue)
      }
      return !rule.matchValue // catchall 不需要 matchValue
    },
    {
      message: 'exact/nonuser 需完整地址；prefix 需不含 @ 的前缀；catchall 不需 matchValue',
    },
  )

export const updateRuleSchema = z.object({
  targets: z.union([z.array(emailSchema), z.string()]).optional(),
  priority: z.coerce.number().int().min(0).max(10000).optional(),
  active: z.boolean().optional(),
})

export function newOwnershipToken(): string {
  return `clover-verification=${randomBytes(8).toString('hex')}`
}
