import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, routingRules } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { updateRuleSchema } from '@/lib/validators'
import { ruleAliasAddress, syncAliasDelete } from '@/lib/sync'
import { syncPrefixRules } from '@/lib/prefix-sync'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const id = Number((await ctx.params).id)
  const [rule] = await db.select().from(routingRules).where(eq(routingRules.id, id)).limit(1)
  if (!rule) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const parsed = updateRuleSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten() }, { status: 400 })
  }

  const patch: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.targets) patch.targets = JSON.stringify(parsed.data.targets)

  const [row] = await db.update(routingRules).set(patch).where(eq(routingRules.id, id)).returning()
  const routingSynced = (await syncPrefixRules()).ok
  const prefixSynced = rule.matchType === 'prefix' ? routingSynced : null
  await audit(admin.username, 'rule.update', String(id), { ...parsed.data, prefixSynced, routingSynced })
  return NextResponse.json({ ...row, prefixSynced, routingSynced })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const id = Number((await ctx.params).id)
  const [rule] = await db.select().from(routingRules).where(eq(routingRules.id, id)).limit(1)
  if (!rule) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [domain] = await db.select().from(domains).where(eq(domains.id, rule.domainId)).limit(1)
  const aliasAddr = domain ? ruleAliasAddress(rule.matchType, rule.matchValue, domain.name) : null
  const firstTarget = JSON.parse(rule.targets)[0] ?? ''
  const sync = aliasAddr && firstTarget ? await syncAliasDelete(aliasAddr, firstTarget) : null

  await db.delete(routingRules).where(eq(routingRules.id, id))
  // prefix 规则删除后刷新正则表（删掉最后一条时也要写空表）
  const routingSynced = (await syncPrefixRules()).ok
  const prefixSynced = rule.matchType === 'prefix' ? routingSynced : null
  await audit(admin.username, 'rule.delete', String(id), { dmsSynced: sync?.ok ?? null, prefixSynced, routingSynced })
  return NextResponse.json({ ok: true, prefixSynced, routingSynced })
}
