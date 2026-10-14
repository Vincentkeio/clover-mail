import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { parseCredentials } from '@/lib/webauthn'

export const dynamic = 'force-dynamic'

/** 当前账号已注册的 Passkey 列表 */
export async function GET() {
  const current = await getCurrentAdmin()
  if (!current) return unauthorized()
  if (current.id === 0) return NextResponse.json([])

  const [admin] = await db.select().from(admins).where(eq(admins.id, current.id)).limit(1)
  const list = parseCredentials(admin?.webauthnCredentials ?? null).map((c) => ({
    id: c.id,
    name: c.name ?? '未命名',
    deviceType: c.deviceType ?? null,
    createdAt: c.createdAt,
  }))
  return NextResponse.json(list)
}

/** 删除某个 Passkey（?id=），至少保留 0 个（可用密码+ TOTP 登录） */
export async function DELETE(req: Request) {
  const current = await getCurrentAdmin()
  if (!current || current.id === 0) return unauthorized()

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const [admin] = await db.select().from(admins).where(eq(admins.id, current.id)).limit(1)
  if (!admin) return NextResponse.json({ error: 'admin not found' }, { status: 404 })

  const list = parseCredentials(admin.webauthnCredentials)
  const next = list.filter((c) => c.id !== id)
  if (next.length === list.length) {
    return NextResponse.json({ error: '凭据不存在' }, { status: 404 })
  }

  await db.update(admins).set({ webauthnCredentials: JSON.stringify(next) }).where(eq(admins.id, admin.id))
  await audit(admin.username, 'auth.passkey_deleted', undefined, { id: id.slice(0, 8) })
  return NextResponse.json({ ok: true, remaining: next.length })
}
