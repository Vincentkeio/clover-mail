import { NextResponse } from 'next/server'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { requireWebmailAdmin } from '@/lib/webmail-auth'
import { getMessage, moveMessage, setMessageLabel, setMessageStarred, setMessageUnread } from '@/lib/webmail-service'

export const dynamic = 'force-dynamic'
const query = z.object({ login: z.string().email(), folder: z.string().min(1).max(200) })
const update = z.object({ login: z.string().email(), folder: z.string().min(1).max(200), unread: z.boolean().optional(), trash: z.boolean().optional(), starred: z.boolean().optional(), label: z.string().min(1).max(40).optional(), labelEnabled: z.boolean().optional() })

export async function GET(request: Request, context: { params: Promise<{ uid: string }> }) {
  const auth = await requireWebmailAdmin(request)
  if (auth.response) return auth.response
  const { uid: rawUid } = await context.params
  const uid = Number(rawUid)
  const params = query.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!Number.isSafeInteger(uid) || uid <= 0 || !params.success) return NextResponse.json({ error: '邮件地址无效。' }, { status: 400 })
  try {
    return NextResponse.json({ message: await getMessage(params.data.login, params.data.folder, uid, new URL(request.url).searchParams.get('remote') === '1') }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '读取邮件失败。' }, { status: 502 })
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ uid: string }> }) {
  const auth = await requireWebmailAdmin(request, true)
  if (auth.response) return auth.response
  const { uid: rawUid } = await context.params
  const uid = Number(rawUid)
  const body = update.safeParse(await request.json().catch(() => null))
  const data = body.success ? body.data : null
  if (!Number.isSafeInteger(uid) || uid <= 0 || !data || [data.unread, data.trash, data.starred, data.labelEnabled].every((value) => value === undefined) || (data.labelEnabled !== undefined && !data.label)) {
    return NextResponse.json({ error: '请求内容无效。' }, { status: 400 })
  }
  try {
    if (data.trash) {
      await moveMessage(data.login, data.folder, uid, 'trash')
      await audit(auth.admin.username, 'webmail.message.trash', data.login, { folder: data.folder, uid })
    } else if (data.unread !== undefined) await setMessageUnread(data.login, data.folder, uid, data.unread)
    else if (data.starred !== undefined) await setMessageStarred(data.login, data.folder, uid, data.starred)
    else if (data.label && data.labelEnabled !== undefined) await setMessageLabel(data.login, data.folder, uid, data.label, data.labelEnabled)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '更新邮件失败。' }, { status: 502 })
  }
}
