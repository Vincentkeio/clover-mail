import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { newTotpSecret, totpQrDataUrl, totpUri, verifyTotp } from '@/lib/totp'

export const dynamic = 'force-dynamic'

/** 开启流程第 1 步：生成密钥 + 二维码（此时尚未写入，需 verify 才生效） */
export async function POST() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  if (admin.id === 0) {
    return NextResponse.json({ error: 'DEMO_MODE 下不允许开启两步验证' }, { status: 400 })
  }

  const [row] = await db.select().from(admins).where(eq(admins.id, admin.id)).limit(1)
  if (!row) return NextResponse.json({ error: 'admin not found' }, { status: 404 })
  if (row.totpSecret) {
    return NextResponse.json({ error: '两步验证已开启；如需更换请先关闭' }, { status: 409 })
  }

  const secret = newTotpSecret()
  const [uri, qr] = await Promise.all([Promise.resolve(totpUri(row.username, secret)), totpQrDataUrl(row.username, secret)])
  return NextResponse.json({ secret, uri, qr, issuer: 'clover 三叶草邮局', username: row.username })
}

/** 开启流程第 2 步：提交密钥 + 一次性验证码 → 落库生效 */
export async function PUT(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin || admin.id === 0) return unauthorized()

  const body = await req.json().catch(() => null)
  const secret = String(body?.secret ?? '').replace(/\s/g, '').toUpperCase()
  const code = String(body?.code ?? '')
  if (!/^[A-Z2-7]{16,64}$/.test(secret)) {
    return NextResponse.json({ error: '密钥格式不正确' }, { status: 400 })
  }

  const [row] = await db.select().from(admins).where(eq(admins.id, admin.id)).limit(1)
  if (!row) return NextResponse.json({ error: 'admin not found' }, { status: 404 })
  if (!verifyTotp(row.username, secret, code)) {
    return NextResponse.json({ error: '验证码不正确（请用应用里显示的当前码）' }, { status: 400 })
  }

  await db.update(admins).set({ totpSecret: secret }).where(eq(admins.id, admin.id))
  await audit(admin.username, 'auth.totp_enabled')
  return NextResponse.json({ ok: true })
}

/** 关闭：需当前一次性码 */
export async function DELETE(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin || admin.id === 0) return unauthorized()

  const body = await req.json().catch(() => null)
  const code = String(body?.code ?? '')

  const [row] = await db.select().from(admins).where(eq(admins.id, admin.id)).limit(1)
  if (!row?.totpSecret) return NextResponse.json({ error: '两步验证未开启' }, { status: 400 })
  if (!verifyTotp(row.username, row.totpSecret, code)) {
    return NextResponse.json({ error: '验证码不正确' }, { status: 400 })
  }

  await db.update(admins).set({ totpSecret: null }).where(eq(admins.id, admin.id))
  await audit(admin.username, 'auth.totp_disabled')
  return NextResponse.json({ ok: true })
}
