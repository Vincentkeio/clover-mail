import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { consumeChallenge, getRpConfig, parseCredentials, type StoredCredential } from '@/lib/webauthn'

export const dynamic = 'force-dynamic'

/** Passkey 注册第 2 步：校验 attestation → 落库（可带昵称） */
export async function POST(req: Request) {
  const current = await getCurrentAdmin()
  if (!current || current.id === 0) return unauthorized()

  const body = await req.json().catch(() => null)
  const response = body?.response
  const name = String(body?.name ?? '').trim().slice(0, 40) || null
  if (!response) return NextResponse.json({ error: '缺少注册响应' }, { status: 400 })

  const [admin] = await db.select().from(admins).where(eq(admins.id, current.id)).limit(1)
  if (!admin) return NextResponse.json({ error: 'admin not found' }, { status: 404 })

  const expectedChallenge = await consumeChallenge(admin.username)
  if (!expectedChallenge) {
    return NextResponse.json({ error: '挑战已过期，请重试' }, { status: 400 })
  }

  const { rpID, origin } = await getRpConfig()

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    })
  } catch (err) {
    await audit(admin.username, 'auth.passkey_register_failed', undefined, { error: String(err) })
    return NextResponse.json({ error: `注册校验失败：${err instanceof Error ? err.message : err}` }, { status: 400 })
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: '注册校验未通过' }, { status: 400 })
  }

  const info = verification.registrationInfo
  const cred = info.credential
  const stored: StoredCredential = {
    id: cred.id,
    publicKey: Buffer.from(cred.publicKey).toString('base64url'),
    counter: cred.counter,
    transports: (cred.transports ?? []) as string[],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    name: name ?? undefined,
    createdAt: new Date().toISOString(),
  }

  const next = [...parseCredentials(admin.webauthnCredentials), stored]
  await db.update(admins).set({ webauthnCredentials: JSON.stringify(next) }).where(eq(admins.id, admin.id))
  await audit(admin.username, 'auth.passkey_registered', undefined, { name: stored.name, deviceType: stored.deviceType })

  return NextResponse.json({ ok: true, credential: { id: stored.id, name: stored.name, deviceType: stored.deviceType } })
}
