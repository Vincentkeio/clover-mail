import { NextResponse } from 'next/server'
import { listMessages, listSendAttempts } from '@/lib/webmail-service'
import { requireWebmailAdmin } from '@/lib/webmail-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireWebmailAdmin(request)
  if (auth.response) return auth.response
  const params = new URL(request.url).searchParams
  const login = params.get('login') || ''
  const folder = params.get('folder') || 'INBOX'
  try {
    const query = params.get('q') || ''
    const [messages, sendAttempts] = await Promise.all([listMessages(login, folder, { query }), listSendAttempts(login)])
    return NextResponse.json({ messages, sendAttempts }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '无法读取邮件。' }, { status: 502 })
  }
}
