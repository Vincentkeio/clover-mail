import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { mailboxes } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { updateMailboxSchema } from '@/lib/validators'
import { syncMailboxDelete, syncMailboxPassword, syncMailboxQuota, type SyncResult } from '@/lib/sync'
import { syncMailboxPolicies } from '@/lib/mailbox-policy-sync'
import { getTranslator } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const t = await getTranslator()
  const id = Number((await ctx.params).id)
  const [box] = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1)
  if (!box) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const parsed = updateMailboxSchema(t).safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten() }, { status: 400 })
  }

  const syncs: Promise<SyncResult>[] = []
  if (parsed.data.password) syncs.push(syncMailboxPassword(box.login, parsed.data.password))
  if (parsed.data.quotaMb !== undefined) syncs.push(syncMailboxQuota(box.login, parsed.data.quotaMb))
  const results = await Promise.all(syncs)
  if (results.some((result) => !result.ok)) {
    await audit(admin.username, 'mailbox.update', box.login, { synced: false })
    return NextResponse.json({ error: t('apiAuth.mailboxes.serviceUpdateFailed') }, { status: 502 })
  }

  const { active, quotaMb } = parsed.data
  const changes = { ...(active !== undefined ? { active } : {}), ...(quotaMb !== undefined ? { quotaMb } : {}) }
  const row = Object.keys(changes).length ? (await db.update(mailboxes).set(changes).where(eq(mailboxes.id, id)).returning())[0] : box
  const policyChanged = 'active' in parsed.data
  const policySync = policyChanged ? await syncMailboxPolicies() : { ok: true as const }
  await audit(admin.username, 'mailbox.update', box.login, {
    synced: policySync.ok,
  })
  if (!policySync.ok) return NextResponse.json({ error: t('apiAuth.mailboxes.settingsSyncFailed', { error: policySync.error }), ...row }, { status: 502 })
  return NextResponse.json(row)
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()

  const id = Number((await ctx.params).id)
  const [box] = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1)
  if (!box) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const sync = await syncMailboxDelete(box.login)
  if (!sync.ok) {
    await audit(admin.username, 'mailbox.delete', box.login, { dmsSynced: false })
    return NextResponse.json({ error: t('apiAuth.mailboxes.serviceDeleteFailed') }, { status: 502 })
  }
  await db.delete(mailboxes).where(eq(mailboxes.id, id))
  const policySync = await syncMailboxPolicies()
  await audit(admin.username, 'mailbox.delete', box.login, { dmsSynced: sync.ok, policySynced: policySync.ok })
  return NextResponse.json({ ok: true, policySynced: policySync.ok, policyError: policySync.ok ? undefined : policySync.error })
}
