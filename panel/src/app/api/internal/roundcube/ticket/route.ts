import { NextResponse } from 'next/server'
import { consumeRoundcubeTicket, validRoundcubeKey } from '@/lib/roundcube-sso'
import { getTranslator } from '@/lib/i18n/server'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  if (!validRoundcubeKey(request.headers.get('x-clover-sso-key'))) return new Response(null, { status: 403 })
  const t = await getTranslator()
  const body = await request.json().catch(() => null)
  try {
    return NextResponse.json(await consumeRoundcubeTicket(String(body?.ticket || ''), t), { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: t('apiAuth.roundcube.ticketRejected') }, { status: 401 }) }
}
