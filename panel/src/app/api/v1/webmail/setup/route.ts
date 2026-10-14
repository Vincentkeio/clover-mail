import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { mailboxes } from '@/db/schema'
import { audit } from '@/lib/audit'
import { getWebmailMasterSetupStatus, startWebmailMasterSetup } from '@/lib/webmail-master'
import { requireWebmailAdmin } from '@/lib/webmail-auth'

export const dynamic = 'force-dynamic'

/** Read or initialize the server-side IMAP/SMTP bridge for the selected mailbox. */
export async function GET(request: Request) {
  const auth = await requireWebmailAdmin(request)
  if (auth.response) return auth.response
  return NextResponse.json(await getWebmailMasterSetupStatus(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const auth = await requireWebmailAdmin(request, true)
  if (auth.response) return auth.response
  const body = await request.json().catch(() => null)
  const login = String(body?.login ?? '').trim().toLowerCase()
  if (!login) return NextResponse.json({ error: '请先选择邮箱。' }, { status: 400 })
  const [box] = await db.select({ login: mailboxes.login, active: mailboxes.active })
    .from(mailboxes).where(eq(mailboxes.login, login)).limit(1)
  if (!box || !box.active) return NextResponse.json({ error: '邮箱不存在或已停用。' }, { status: 404 })
  const status = await startWebmailMasterSetup()
  if (status.state === 'ready') {
    await audit(auth.admin.username, 'webmail.open', login)
    return NextResponse.json(status)
  }
  return NextResponse.json(status, { status: 202, headers: { 'Cache-Control': 'no-store' } })
}
