import { NextResponse } from 'next/server'
import { listFolders } from '@/lib/webmail-service'
import { requireWebmailAdmin } from '@/lib/webmail-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireWebmailAdmin(request)
  if (auth.response) return auth.response
  const login = new URL(request.url).searchParams.get('login') || ''
  try {
    return NextResponse.json({ folders: await listFolders(login) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '无法连接邮件服务。' }, { status: 502 })
  }
}
