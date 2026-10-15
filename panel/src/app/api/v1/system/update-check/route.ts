import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { checkUpdates } from '@/lib/update-check'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
async function check(manual: boolean) {
  if (!await getCurrentAdmin()) return unauthorized()
  try {
    const cache = await checkUpdates(manual)
    return NextResponse.json({ result: cache.result, error: cache.error, checkedAt: cache.checkedAt }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '检查更新失败。' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
export async function GET() { return check(false) }
export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  try {
    if (origin && new URL(origin).host !== host) return new Response(null, { status: 403 })
  } catch { return new Response(null, { status: 403 }) }
  return check(true)
}
