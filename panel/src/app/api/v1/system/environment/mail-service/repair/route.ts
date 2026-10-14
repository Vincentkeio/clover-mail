import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/db'
import { mailboxes } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { ensureMailListeners } from '@/lib/mail-listeners'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const origin = req.headers.get('origin')
  const requestHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host
  if (origin && new URL(origin).host !== requestHost) return NextResponse.json({ error: '请求来源无效' }, { status: 403 })

  const mailHost = process.env.MAIL_HOSTNAME || process.env.MAIL_FQDN || ''
  if (!mailHost) return NextResponse.json({ error: '请先到「面板设置 → 面板与邮件主机」配置邮件主机名。', href: '/panel-settings#mail-host' }, { status: 409 })

  const activeMailboxes = await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.active, true)).limit(1)
  if (!activeMailboxes.length) return NextResponse.json({ error: '尚未创建启用中的邮箱账户。请先到「邮箱账户」创建至少一个账户，Dovecot 才会启动。', href: '/mailboxes' }, { status: 409 })

  try {
    const result = await ensureMailListeners()
    await audit(admin.username, 'environment.mail_service_repair', 'docker-mailserver', {
      ports: result.ports.map((item) => item.port), restored: result.ok,
    })
    if (result.ok) return NextResponse.json({ ok: true, message: result.message })
    return NextResponse.json({ error: result.message, href: '/monitor/queue' }, { status: 502 })
  } catch (err) {
    const message = err instanceof Error ? err.message : '无法恢复邮件服务监听'
    return NextResponse.json({ error: `修复失败：${message}`, href: '/monitor/queue' }, { status: 502 })
  }
}
