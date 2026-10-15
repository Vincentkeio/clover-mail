import { NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, routingRules } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { createRuleSchema } from '@/lib/validators'
import { ruleAliasAddress, syncAliasAdd } from '@/lib/sync'
import { syncPrefixRules } from '@/lib/prefix-sync'

export const dynamic = 'force-dynamic'

/** 规则去重键：matchType + matchValue（catchall 的 matchValue 为空） */
function ruleKey(matchType: string, matchValue: string | null | undefined): string {
  return `${matchType}:${matchValue ?? ''}`
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const id = Number((await ctx.params).id)
  const rows = await db
    .select()
    .from(routingRules)
    .where(eq(routingRules.domainId, id))
    .orderBy(asc(routingRules.priority), asc(routingRules.id))
  return NextResponse.json(rows)
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const id = Number((await ctx.params).id)
  const [domain] = await db.select().from(domains).where(eq(domains.id, id)).limit(1)
  if (!domain) return NextResponse.json({ error: 'domain_not_found' }, { status: 404 })
  if (!domain.active) return NextResponse.json({ error: '请先启用该域名，再创建转发规则。' }, { status: 409 })

  const parsed = createRuleSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten() }, { status: 400 })
  }
  const { matchType, matchValue, targets, priority, active } = parsed.data

  // exact/nonuser 的地址必须属于本域
  if ((matchType === 'exact' || matchType === 'nonuser') && matchValue) {
    const part = matchValue.split('@')[1]?.toLowerCase()
    if (part !== domain.name) {
      return NextResponse.json({ error: `地址必须属于 ${domain.name}` }, { status: 422 })
    }
  }

  // 同一 match 键唯一（catchall 每域仅一条）
  const key = ruleKey(matchType, matchValue)
  const existing = await db.select().from(routingRules).where(eq(routingRules.domainId, id))
  if (existing.some((r) => ruleKey(r.matchType, r.matchValue) === key)) {
    return NextResponse.json({ error: '同类型同匹配值的规则已存在' }, { status: 409 })
  }

  const [row] = await db
    .insert(routingRules)
    .values({
      domainId: id,
      matchType,
      matchValue: matchValue ?? null,
      targets: JSON.stringify(targets),
      priority,
      active,
    })
    .returning()

  const aliasAddr = ruleAliasAddress(matchType, matchValue ?? null, domain.name)
  const dmsSupported = aliasAddr !== null
  let dmsSynced = false
  if (dmsSupported && active) {
    const sync = await syncAliasAdd(aliasAddr!, targets)
    dmsSynced = sync.ok
  }
  // prefix 规则走 pcre 正则别名表（DMS 无原生前缀支持）
  let prefixSynced: boolean | null = null
  if (matchType === 'prefix') {
    prefixSynced = (await syncPrefixRules()).ok
  }

  await audit(admin.username, 'rule.create', `${domain.name}:${key}`, { dmsSupported, dmsSynced, prefixSynced })
  return NextResponse.json({ ...row, dmsSupported, dmsSynced, prefixSynced }, { status: 201 })
}
