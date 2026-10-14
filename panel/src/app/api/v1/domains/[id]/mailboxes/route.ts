import { NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { createMailboxSchema } from '@/lib/validators'
import { syncMailboxCreate } from '@/lib/sync'
import { ensureMailListeners } from '@/lib/mail-listeners'
import { syncMailboxPolicies } from '@/lib/mailbox-policy-sync'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const id = Number((await ctx.params).id)
  const rows = await db.select().from(mailboxes).where(eq(mailboxes.domainId, id)).orderBy(asc(mailboxes.id))
  return NextResponse.json(rows)
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const id = Number((await ctx.params).id)
  const [domain] = await db.select().from(domains).where(eq(domains.id, id)).limit(1)
  if (!domain) return NextResponse.json({ error: 'domain_not_found' }, { status: 404 })

  const parsed = createMailboxSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten() }, { status: 400 })
  }
  const { login, password, quotaMb } = parsed.data

  const domainPart = login.split('@')[1]?.toLowerCase()
  if (domainPart !== domain.name) {
    return NextResponse.json({ error: `login 必须属于 ${domain.name}` }, { status: 422 })
  }

  try {
    const [row] = await db
      .insert(mailboxes)
      .values({
        domainId: id,
        login,
        passwordHash: null, // M1 明文只在同步 DMS 的瞬间经 CLI 使用，不落库
        quotaMb: quotaMb ?? null,
      })
      .returning()

    const sync = await syncMailboxCreate(login, password, quotaMb)
    const mailboxCreatedInDms = sync.results[0]?.ok ?? false
    const listeners = mailboxCreatedInDms ? await ensureMailListeners() : null
    const policySync = await syncMailboxPolicies()
    await audit(admin.username, 'mailbox.create', login, {
      dmsSynced: sync.ok,
      listenersReady: listeners?.ok ?? null,
      policySynced: policySync.ok,
    })
    return NextResponse.json({
      ...row,
      dmsSynced: sync.ok,
      listenersReady: listeners?.ok ?? null,
      listenerMessage: listeners?.message ?? null,
      policySynced: policySync.ok,
      policyError: policySync.ok ? undefined : policySync.error,
    }, { status: 201 })
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return NextResponse.json({ error: '邮箱地址已存在' }, { status: 409 })
    }
    throw err
  }
}
