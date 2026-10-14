import { NextResponse } from 'next/server'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { requireWebmailAdmin } from '@/lib/webmail-auth'
import { moveMessage } from '@/lib/webmail-service'

export const dynamic = 'force-dynamic'
const schema = z.object({ login: z.string().email(), folder: z.string().min(1).max(200), uid: z.number().int().positive(), action: z.enum(['junk', 'ham']) })

export async function POST(request: Request) {
  const auth = await requireWebmailAdmin(request, true)
  if (auth.response) return auth.response
  const body = schema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: '邮件操作参数无效。' }, { status: 400 })
  try {
    await moveMessage(body.data.login, body.data.folder, body.data.uid, body.data.action === 'junk' ? 'junk' : 'inbox')
    await audit(auth.admin.username, `webmail.message.${body.data.action}`, body.data.login, { folder: body.data.folder, uid: body.data.uid })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '邮件操作失败。' }, { status: 502 })
  }
}
