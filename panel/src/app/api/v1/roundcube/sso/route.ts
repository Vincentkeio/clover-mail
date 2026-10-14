import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { issueRoundcubeTicket } from '@/lib/roundcube-sso'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  if (request.headers.has('authorization')) return unauthorized()
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'same-site') return NextResponse.json({ error: '请从面板进入 Roundcube。' }, { status: 403 })
  if (origin) {
    try { if (new URL(origin).host !== host) return NextResponse.json({ error: '请求来源无效。' }, { status: 403 }) }
    catch { return NextResponse.json({ error: '请求来源无效。' }, { status: 403 }) }
  }
  const form = await request.formData().catch(() => null)
  const login = String(form?.get('login') || '').trim().toLowerCase()
  try {
    const ticket = await issueRoundcubeTicket(login, admin.id)
    await audit(admin.username, 'roundcube.open', login)
    const nonce = randomBytes(18).toString('base64')
    const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>正在打开 Roundcube</title><form id="sso" method="post" action="/webmail/?_task=login&amp;_action=plugin.clover_sso"><input type="hidden" name="_clover_ticket" value="' + ticket + '"><button type="submit">进入 Roundcube</button></form><script nonce="' + nonce + '">document.getElementById("sso").submit()</script></html>'
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; script-src 'nonce-" + nonce + "'" } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Roundcube 登录失败。' }, { status: 502 })
  }
}
