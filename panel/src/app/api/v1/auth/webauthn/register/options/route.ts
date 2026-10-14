import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { getRpConfig, parseCredentials, saveChallenge } from '@/lib/webauthn'

export const dynamic = 'force-dynamic'

/** Passkey 注册第 1 步：已登录管理员获取注册选项 */
export async function POST() {
  const current = await getCurrentAdmin()
  if (!current) return unauthorized()
  if (current.id === 0) {
    return NextResponse.json({ error: 'DEMO_MODE 下不允许注册 Passkey' }, { status: 400 })
  }

  const [admin] = await db.select().from(admins).where(eq(admins.id, current.id)).limit(1)
  if (!admin) return NextResponse.json({ error: 'admin not found' }, { status: 404 })

  const existing = parseCredentials(admin.webauthnCredentials)
  const { rpID, rpName } = await getRpConfig()

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
