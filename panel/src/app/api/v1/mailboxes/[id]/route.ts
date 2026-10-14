import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { mailboxes } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { updateMailboxSchema } from '@/lib/validators'
import { syncMailboxDelete, syncMailboxPassword, syncMailboxQuota } from '@/lib/sync'
import { syncMailboxPolicies } from '@/lib/mailbox-policy-sync'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const id = Number((await ctx.params).id)
  const [box] = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1)
  if (!box) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const parsed = updateMailboxSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten() }, { status: 400 })
  }

  const syncs: Promise<unknown>[] = []
  if (parsed.data.password) syncs.push(syncMailboxPassword(box.login, parsed.data.password))
  if (parsed.data.quotaMb !== undefined) syncs.push(syncMailboxQuota(box.login, parsed.data.quotaMb))
  const results = await Promise.all(syncs)

  const [row] = await db.update(mailboxes).set(parsed.data).where(eq(mailboxes.id, id)).returning()
  const policyChanged = 'active' in parsed.data
  const policySync = policyChanged ? await syncMailboxPolicies() : { ok: true as const }
  await audit(admin.username, 'mailbox.update', box.login, {
    synced: results.every(Boolean) && policySync.ok,
  })
  if (!policySync.ok) return NextResponse.json({ error: `邮箱设置已保存，但邮件服务应用失败：${policySync.error}`, ...row }, { status: 502 })
  return NextResponse.json(row)
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const id = Number((await ctx.params).id)
  const [box] = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1)
  if (!box) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const sync = await syncMailboxDelete(box.login)
  await db.delete(mailboxes).where(eq(mailboxes.id, id))
  const policySync = await syncMailboxPolicies()
  await audit(admin.username, 'mailbox.delete', box.login, { dmsSynced: sync.ok, policySynced: policySync.ok })
  return NextResponse.json({ ok: true, policySynced: policySync.ok, policyError: policySync.ok ? undefined : policySync.error })
}
