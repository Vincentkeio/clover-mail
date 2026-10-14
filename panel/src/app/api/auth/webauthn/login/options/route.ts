import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { audit } from '@/lib/audit'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { getRpConfig, parseCredentials, saveChallenge } from '@/lib/webauthn'

export const dynamic = 'force-dynamic'

/** Passkey 登录第 1 步：公开端点，按用户名给 allowCredentials（不暴露是否存在之外的细节） */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const username = String(body?.username ?? '').trim()
  if (!username) return NextResponse.json({ error: '缺少用户名' }, { status: 400 })

  const [admin] = await db.select().from(admins).where(eq(admins.username, username)).limit(1)
  const creds = parseCredentials(admin?.webauthnCredentials ?? null)
  if (!admin || creds.length === 0) {
    return NextResponse.json({ error: '该账号未注册 Passkey' }, { status: 404 })
  }

  const { rpID } = await getRpConfig()
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: creds.map((c) => ({ id: c.id, transports: (c.transports ?? []) as never })),
  })
  await saveChallenge(username, options.challenge)
  return NextResponse.json(options)
}
