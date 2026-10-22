import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { audit } from '@/lib/audit'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { getRpConfig, parseCredentials, saveChallenge } from '@/lib/webauthn'
import { getTranslator } from '@/lib/i18n/server'
import { limitLogin } from '@/lib/login-rate-limit'
import { hasTrustedOrigin } from '@/lib/request-origin'

export const dynamic = 'force-dynamic'

/** Passkey 登录第 1 步：公开端点，按用户名给 allowCredentials（不暴露是否存在之外的细节） */
export async function POST(req: Request) {
  if (!hasTrustedOrigin(req.headers, req.url)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  const t = await getTranslator()
  const body = await req.json().catch(() => null)
  const username = String(body?.username ?? '').trim()
  if (!username || username.length > 32) return NextResponse.json({ error: t('apiAuth.webauthn.usernameRequired') }, { status: 400 })
  const limited = limitLogin(username)
  if (limited) return limited

  const [admin] = await db.select().from(admins).where(eq(admins.username, username)).limit(1)
  const creds = parseCredentials(admin?.webauthnCredentials ?? null)
  if (!admin || creds.length === 0) {
    return NextResponse.json({ error: t('apiAuth.webauthn.notRegistered') }, { status: 404 })
  }

  const { rpID } = await getRpConfig(t)
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({ id: c.id, transports: (c.transports ?? []) as never })),
  })
  await saveChallenge(username, options.challenge, 'login', admin.passwordHash)
  return NextResponse.json(options)
}
