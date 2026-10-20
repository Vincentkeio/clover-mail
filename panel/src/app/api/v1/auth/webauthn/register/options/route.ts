import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { getRpConfig, parseCredentials, saveChallenge } from '@/lib/webauthn'
import { getTranslator } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

/** Passkey 注册第 1 步：已登录管理员获取注册选项 */
export async function POST() {
  const current = await getCurrentAdmin()
  if (!current) return unauthorized()
  const t = await getTranslator()
  if (current.id === 0) {
    return NextResponse.json({ error: t('apiAuth.webauthn.demoRegisterForbidden') }, { status: 400 })
  }

  const [admin] = await db.select().from(admins).where(eq(admins.id, current.id)).limit(1)
  if (!admin) return NextResponse.json({ error: t('apiAuth.adminNotFound') }, { status: 404 })

  const existing = parseCredentials(admin.webauthnCredentials)
  const { rpID, rpName } = await getRpConfig(t)

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: admin.username,
    userDisplayName: `${admin.username} @ clover`,
    userID: new TextEncoder().encode(`clover-admin-${admin.id}`),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: (c.transports ?? []) as never })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  await saveChallenge(admin.username, options.challenge)
  return NextResponse.json(options)
}
