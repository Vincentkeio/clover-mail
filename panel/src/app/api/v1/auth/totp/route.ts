import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { newTotpSecret, totpQrDataUrl, totpUri, verifyTotp } from '@/lib/totp'
import { getTranslator } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

/** 开启流程第 1 步：生成密钥 + 二维码（此时尚未写入，需 verify 才生效） */
export async function POST() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  if (admin.id === 0) {
    return NextResponse.json({ error: t('apiAuth.totp.demoEnableForbidden') }, { status: 400 })
  }

  const [row] = await db.select().from(admins).where(eq(admins.id, admin.id)).limit(1)
  if (!row) return NextResponse.json({ error: t('apiAuth.adminNotFound') }, { status: 404 })
  if (row.totpSecret) {
    return NextResponse.json({ error: t('apiAuth.totp.alreadyEnabled') }, { status: 409 })
  }

  const secret = newTotpSecret()
  const [uri, qr] = await Promise.all([Promise.resolve(totpUri(row.username, secret, t)), totpQrDataUrl(row.username, secret, t)])
  return NextResponse.json({ secret, uri, qr, issuer: t('common.appTitle'), username: row.username }, { headers: { 'Cache-Control': 'no-store' } })
}

/** 开启流程第 2 步：提交密钥 + 一次性验证码 → 落库生效 */
export async function PUT(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin || admin.id === 0) return unauthorized()

  const t = await getTranslator()
  const body = await req.json().catch(() => null)
  const secret = String(body?.secret ?? '').replace(/\s/g, '').toUpperCase()
  const code = String(body?.code ?? '')
  if (!/^[A-Z2-7]{16,64}$/.test(secret)) {
    return NextResponse.json({ error: t('apiAuth.totp.invalidSecret') }, { status: 400 })
  }

  const [row] = await db.select().from(admins).where(eq(admins.id, admin.id)).limit(1)
  if (!row) return NextResponse.json({ error: t('apiAuth.adminNotFound') }, { status: 404 })
  if (!verifyTotp(row.username, secret, code)) {
    return NextResponse.json({ error: t('apiAuth.totp.codeStale') }, { status: 400 })
  }

  await db.update(admins).set({ totpSecret: secret }).where(eq(admins.id, admin.id))
  await audit(admin.username, 'auth.totp_enabled')
  return NextResponse.json({ ok: true })
}

/** 关闭：需当前一次性码 */
export async function DELETE(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin || admin.id === 0) return unauthorized()

  const t = await getTranslator()
  const body = await req.json().catch(() => null)
  const code = String(body?.code ?? '')

  const [row] = await db.select().from(admins).where(eq(admins.id, admin.id)).limit(1)
  if (!row?.totpSecret) return NextResponse.json({ error: t('apiAuth.totp.notEnabled') }, { status: 400 })
  if (!verifyTotp(row.username, row.totpSecret, code)) {
    return NextResponse.json({ error: t('apiAuth.totp.codeInvalid') }, { status: 400 })
  }

  await db.update(admins).set({ totpSecret: null }).where(eq(admins.id, admin.id))
  await audit(admin.username, 'auth.totp_disabled')
  return NextResponse.json({ ok: true })
}
