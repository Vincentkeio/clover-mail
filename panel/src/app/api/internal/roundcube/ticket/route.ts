import { NextResponse } from 'next/server'
import { consumeRoundcubeTicket, validRoundcubeKey } from '@/lib/roundcube-sso'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  if (!validRoundcubeKey(request.headers.get('x-clover-sso-key'))) return new Response(null, { status: 403 })
  const body = await request.json().catch(() => null)
  try {
    return NextResponse.json(await consumeRoundcubeTicket(String(body?.ticket || '')), { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: '登录凭据已使用、过期或邮箱不可用。' }, { status: 401 }) }
}
