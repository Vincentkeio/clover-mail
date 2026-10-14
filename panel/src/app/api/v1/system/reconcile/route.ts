import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { runReconcile } from '@/lib/reconcile'

export const dynamic = 'force-dynamic'

/**
 * 对账任务入口。两种调用方式：
 * 1. 面板内（管理员 session）
 * 2. 宿主机 cron（Authorization: Bearer <RECONCILE_TOKEN>，无需登录）
 */
export async function POST(req: Request) {
  const token = process.env.RECONCILE_TOKEN
  const bearer = req.headers.get('authorization')
  const tokenOk = !!token && bearer === `Bearer ${token}`
  const admin = await getCurrentAdmin()
  if (!admin && !tokenOk) return unauthorized()

  const body = await req.json().catch(() => ({}))
  const heal = body?.heal === true
  const report = await runReconcile({ heal })

  if (admin) {
    await audit(admin.username, 'system.reconcile', undefined, {
      heal,
      missing: report.mailboxes.missing.length + report.rules.missing.length,
      extra: report.mailboxes.extra.length + report.rules.extra.length,
      healed: report.healed.length,
    })
  }
  return NextResponse.json(report)
}
