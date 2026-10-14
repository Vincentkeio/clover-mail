import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { verifyPassword } from '@/lib/password'
import { createSessionToken, sessionCookie } from '@/lib/session'
import { verifyTotp } from '@/lib/totp'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const username = String(body?.username ?? '').trim()
  const password = String(body?.password ?? '')
  const totp = String(body?.totp ?? '')
  if (!username || !password) {
    return NextResponse.json({ error: 'missing_credentials' }, { status: 400 })
  }

  const [admin] = await db
    .select()
    .from(admins)
    .where(eq(admins.username, username))
    .limit(1)

  // M4 TODO: 登录失败限流（按 IP 计数，防暴力破解）
  if (!admin?.passwordHash || !(await verifyPassword(admin.passwordHash, password))) {
    await audit(username || '(empty)', 'auth.login_failed')
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }

  // 两步验证：密码通过但没有码 → 让前端补输（不泄露是否已开启之外的信息）
  if (admin.totpSecret) {
    if (!totp) {
      return NextResponse.json({ error: 'totp_required' }, { status: 401 })
    }
    if (!verifyTotp(admin.username, admin.totpSecret, totp)) {
      await audit(admin.username, 'auth.totp_failed')
      return NextResponse.json({ error: 'invalid_totp' }, { status: 401 })
    }
  }

  const store = await cookies()
  store.set(sessionCookie.name, createSessionToken(admin.id), {
    ...sessionCookie.options,
    maxAge: sessionCookie.maxAge,
  })
  await db.update(admins).set({ lastLoginAt: new Date().toISOString() }).where(eq(admins.id, admin.id))
  await audit(admin.username, 'auth.login')
  return NextResponse.json({ ok: true })
}
