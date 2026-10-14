import { NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes, routingRules } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { updateDomainSchema } from '@/lib/validators'
import { syncAliasAdd, syncAliasDelete, syncDomainDelete, syncMailboxDelete, ruleAliasAddress } from '@/lib/sync'

export const dynamic = 'force-dynamic'

async function loadDomain(id: number) {
  const [row] = await db.select().from(domains).where(eq(domains.id, id)).limit(1)
  return row ?? null
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const { id: idParam } = await ctx.params
  const id = Number(idParam)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

  const domain = await loadDomain(id)
  if (!domain) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [boxes, rules] = await Promise.all([
    db.select().from(mailboxes).where(eq(mailboxes.domainId, id)).orderBy(asc(mailboxes.id)),
    db.select().from(routingRules).where(eq(routingRules.domainId, id)).orderBy(asc(routingRules.priority), asc(routingRules.id)),
  ])
  return NextResponse.json({ domain, mailboxes: boxes, rules })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const { id: idParam } = await ctx.params
  const id = Number(idParam)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

  const parsed = updateDomainSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten() }, { status: 400 })
  }

  const domain = await loadDomain(id)
  if (!domain) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [row] = await db.update(domains).set(parsed.data).where(eq(domains.id, id)).returning()
  await audit(admin.username, 'domain.update', domain.name, parsed.data)
  return NextResponse.json(row)
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const { id: idParam } = await ctx.params
  const id = Number(idParam)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

  const domain = await loadDomain(id)
  if (!domain) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // 级联删除前，把该域的邮箱/规则一起从 DMS 清理（DB 侧 FK cascade 自动完成）
  const boxes = await db.select().from(mailboxes).where(eq(mailboxes.domainId, id))
  const rules = await db.select().from(routingRules).where(eq(routingRules.domainId, id))

  const cleanup: Promise<unknown>[] = [
    syncDomainDelete(domain.name),
    ...boxes.map((b) => syncMailboxDelete(b.login)),
    ...rules.map((r) => {
      const addr = ruleAliasAddress(r.matchType, r.matchValue, domain.name)
      return addr ? syncAliasDelete(addr, JSON.parse(r.targets)[0] ?? '') : Promise.resolve(null)
    }),
  ]
  await Promise.allSettled(cleanup)

  await db.delete(domains).where(eq(domains.id, id))
  await audit(admin.username, 'domain.delete', domain.name, {
    mailboxes: boxes.map((b) => b.login),
    rules: rules.length,
  })
  return NextResponse.json({ ok: true })
}
