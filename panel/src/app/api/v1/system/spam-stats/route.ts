import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { rspamdOverview } from '@/lib/rspamd'

export const dynamic = 'force-dynamic'

/** rspamd 聚合统计：扫描量 / 符号 TopN / 动作分布（DMS 未连接时降级） */
export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const overview = await rspamdOverview()
  return NextResponse.json(overview)
}
