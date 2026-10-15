import { NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes, routingRules } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { updateDomainSchema } from '@/lib/validators'
import { syncDomainDelete } from '@/lib/sync'
import { syncMailboxPolicies } from '@/lib/mailbox-policy-sync'

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
  if (parsed.data.active !== undefined && parsed.data.active !== domain.active) {
    const policy = await syncMailboxPolicies()
    if (!policy.ok) {
      await db.update(domains).set({ active: domain.active }).where(eq(domains.id, id))
      await syncMailboxPolicies()
      return NextResponse.json({ error: `域名状态未更改：邮件服务应用失败。${policy.error}` }, { status: 502 })
    }
  }
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

  const boxes = await db.select().from(mailboxes).where(eq(mailboxes.domainId, id))
  const rules = await db.select().from(routingRules).where(eq(routingRules.domainId, id))
  if (boxes.length || rules.length) return NextResponse.json({ error: `请先删除 ${boxes.length} 个邮箱和 ${rules.length} 条转发规则，再删除域名。` }, { status: 409 })
  const cleanup = await syncDomainDelete(domain.name)
  if (!cleanup.ok) return NextResponse.json({ error: '邮件服务清理失败，域名仍保留。' }, { status: 502 })

  await db.delete(domains).where(eq(domains.id, id))
  const policy = await syncMailboxPolicies()
  await audit(admin.username, 'domain.delete', domain.name, {
    mailboxes: boxes.map((b) => b.login),
    rules: rules.length,
  })
  return NextResponse.json({ ok: true, policySynced: policy.ok, policyError: policy.ok ? undefined : policy.error })
}
