import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { audit } from '@/lib/audit'
import { createSessionToken, sessionCookie } from '@/lib/session'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { consumeChallenge, getRpConfig, parseCredentials } from '@/lib/webauthn'
import { getTranslator } from '@/lib/i18n/server'
import { clearLoginAttempts, limitLogin } from '@/lib/login-rate-limit'

export const dynamic = 'force-dynamic'

/** Passkey 登录第 2 步：校验断言 → 建会话，并回写 counter（防重放） */
export async function POST(req: Request) {
  const t = await getTranslator()
  const body = await req.json().catch(() => null)
  const username = String(body?.username ?? '').trim()
  const response = body?.response
  if (!username || username.length > 32 || !response) {
    return NextResponse.json({ error: t('apiAuth.webauthn.missingParams') }, { status: 400 })
  }
  const limited = limitLogin(username)
  if (limited) return limited

  const [admin] = await db.select().from(admins).where(eq(admins.username, username)).limit(1)
  const creds = parseCredentials(admin?.webauthnCredentials ?? null)
  if (!admin || creds.length === 0) {
    return NextResponse.json({ error: t('apiAuth.webauthn.notRegistered') }, { status: 404 })
  }

  const expectedChallenge = await consumeChallenge(username)
  if (!expectedChallenge) {
    return NextResponse.json({ error: t('apiAuth.webauthn.challengeExpired') }, { status: 400 })
  }

  const stored = creds.find((c) => c.id === response.id)
  if (!stored) {
    await audit(username, 'auth.passkey_unknown_credential')
    return NextResponse.json({ error: t('apiAuth.webauthn.unknownCredential') }, { status: 400 })
  }

  const { rpID, origin } = await getRpConfig(t)

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: stored.id,
        publicKey: Buffer.from(stored.publicKey, 'base64url'),
        counter: stored.counter,
        transports: (stored.transports ?? []) as never,
      },
    })
  } catch (err) {
    await audit(username, 'auth.passkey_failed', undefined, { error: String(err) })
    return NextResponse.json({ error: t('apiAuth.webauthn.verifyFailed') }, { status: 401 })
  }

  if (!verification.verified) {
    await audit(username, 'auth.passkey_failed')
    return NextResponse.json({ error: t('apiAuth.webauthn.notVerified') }, { status: 401 })
  }

  // 回写新 counter
  const next = creds.map((c) =>
    c.id === stored.id ? { ...c, counter: verification.authenticationInfo.newCounter } : c,
  )
  await db
    .update(admins)
    .set({ webauthnCredentials: JSON.stringify(next), lastLoginAt: new Date().toISOString() })
    .where(eq(admins.id, admin.id))

  const store = await cookies()
  clearLoginAttempts(username)
  store.set(sessionCookie.name, createSessionToken(admin.id, admin.passwordHash), {
    ...sessionCookie.options,
    maxAge: sessionCookie.maxAge,
  })
  await audit(admin.username, 'auth.passkey_login', undefined, { credential: stored.name ?? stored.id.slice(0, 8) })
  return NextResponse.json({ ok: true })
}
