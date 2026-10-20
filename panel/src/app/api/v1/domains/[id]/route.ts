import { NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes, routingRules } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { updateDomainSchema } from '@/lib/validators'
import { ruleAliasAddress, syncAliasDelete, syncDomainDelete, syncMailboxDelete } from '@/lib/sync'
import { syncMailboxPolicies } from '@/lib/mailbox-policy-sync'
import { syncPrefixRules } from '@/lib/prefix-sync'
import { getTranslator } from '@/lib/i18n/server'

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

  const t = await getTranslator()
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
      return NextResponse.json({ error: t('apiErrors.domains.statusNotChanged', { error: policy.error }) }, { status: 502 })
    }
  }
  await audit(admin.username, 'domain.update', domain.name, parsed.data)
  return NextResponse.json(row)
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const t = await getTranslator()
  const { id: idParam } = await ctx.params
  const id = Number(idParam)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

  const domain = await loadDomain(id)
  if (!domain) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const boxes = await db.select().from(mailboxes).where(eq(mailboxes.domainId, id))
  const rules = await db.select().from(routingRules).where(eq(routingRules.domainId, id))
  for (const rule of rules) {
    const address = rule.active ? ruleAliasAddress(rule.matchType, rule.matchValue, domain.name) : null
    const destinations = JSON.parse(rule.targets) as string[]
    if (address) {
      for (const destination of destinations) {
        const sync = await syncAliasDelete(address, destination)
        if (!sync.ok) return NextResponse.json({ error: t('apiErrors.domains.ruleCleanupFailed', { address }) }, { status: 502 })
      }
    }
    await db.delete(routingRules).where(eq(routingRules.id, rule.id))
  }
  if (rules.some((rule) => rule.matchType === 'prefix')) {
    const prefix = await syncPrefixRules()
    if (!prefix.ok) return NextResponse.json({ error: t('apiErrors.domains.prefixSyncFailed') }, { status: 502 })
  }
  for (const box of boxes) {
    const sync = await syncMailboxDelete(box.login)
    if (!sync.ok) return NextResponse.json({ error: t('apiErrors.domains.mailboxCleanupFailed', { login: box.login }) }, { status: 502 })
    await db.delete(mailboxes).where(eq(mailboxes.id, box.id))
  }
  const cleanup = await syncDomainDelete(domain.name)
  if (!cleanup.ok) return NextResponse.json({ error: t('apiErrors.domains.cleanupFailed') }, { status: 502 })

  await db.delete(domains).where(eq(domains.id, id))
  const policy = await syncMailboxPolicies()
  await audit(admin.username, 'domain.delete', domain.name, {
    mailboxes: boxes.map((b) => b.login),
    rules: rules.length,
  })
  return NextResponse.json({ ok: true, policySynced: policy.ok, policyError: policy.ok ? undefined : policy.error })
}
