import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { issueRoundcubeTicket } from '@/lib/roundcube-sso'
import { audit } from '@/lib/audit'
import { getI18n } from '@/lib/i18n/server'
import { HTML_LANG } from '@/lib/i18n/config'
import { hasTrustedOrigin } from '@/lib/request-origin'

export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  if (request.headers.has('authorization')) return unauthorized()
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const { locale, t } = await getI18n()
  if (!hasTrustedOrigin(request.headers, request.url)) return NextResponse.json({ error: t('apiAuth.roundcube.invalidOrigin') }, { status: 403 })
  const form = await request.formData().catch(() => null)
  const login = String(form?.get('login') || '').trim().toLowerCase()
  try {
    const ticket = await issueRoundcubeTicket(login, admin.id, t)
    await audit(admin.username, 'roundcube.open', login)
    const nonce = randomBytes(18).toString('base64')
    const html = '<!doctype html><html lang="' + HTML_LANG[locale] + '"><meta charset="utf-8"><title>' + t('apiAuth.roundcube.openingTitle') + '</title><form id="sso" method="post" action="/webmail/?_task=login&amp;_action=plugin.clover_sso"><input type="hidden" name="_clover_ticket" value="' + ticket + '"><button type="submit">' + t('apiAuth.roundcube.openButton') + '</button></form><script nonce="' + nonce + '">document.getElementById("sso").submit()</script></html>'
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; script-src 'nonce-" + nonce + "'" } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : t('apiAuth.roundcube.loginFailed') }, { status: 502 })
  }
}
