import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { createApiToken, listApiTokens, revokeApiToken } from '@/lib/api-token'
import { getTranslator } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

/** 列出全部 token（只显示前缀，明文永不回显） */
export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  return NextResponse.json(await listApiTokens())
}

/** 创建 token：明文只在本次响应里出现一次 */
export async function POST(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  if (admin.id === 0) {
    return NextResponse.json({ error: t('apiSystem.tokens.demoMode') }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '').trim().slice(0, 60)
  if (!name) return NextResponse.json({ error: t('apiSystem.tokens.nameRequired') }, { status: 400 })

  const created = await createApiToken(name)
  await audit(admin.username, 'api_token.create', name, { id: created.id, prefix: created.prefix })
  return NextResponse.json(created, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}

/** 吊销：?id= */
export async function DELETE(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin || admin.id === 0) return unauthorized()
  const t = await getTranslator()

  const id = Number(new URL(req.url).searchParams.get('id'))
  if (!Number.isInteger(id)) return NextResponse.json({ error: t('apiSystem.tokens.idMissing') }, { status: 400 })

  const ok = await revokeApiToken(id)
  if (!ok) return NextResponse.json({ error: t('apiSystem.tokens.notFound') }, { status: 404 })

  await audit(admin.username, 'api_token.revoke', String(id))
  return NextResponse.json({ ok: true })
}
