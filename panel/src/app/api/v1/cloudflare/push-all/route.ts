import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { allDomains, ensureDomainRecords, pushDomainDns, type PushOutcome } from '@/lib/cf-sync'
import { getCfToken } from '@/lib/settings'

export const dynamic = 'force-dynamic'

/** 把面板里**所有**域的记录一并推送到 Cloudflare（每域一次 batch，幂等） */
export async function POST() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const token = await getCfToken()
  if (!token) {
    return NextResponse.json({ error: '未配置 Cloudflare API Token（设置页录入）' }, { status: 400 })
  }

  const rows = await allDomains()
  const results: PushOutcome[] = []
  for (const row of rows) {
    await ensureDomainRecords(row)
    results.push(await pushDomainDns(row, token))
  }

  const ok = results.filter((r) => r.ok).length
  await audit(admin.username, 'cloudflare.push_all', `${results.length} 个域`, { ok, failed: results.length - ok })
  return NextResponse.json({
    total: results.length,
    ok,
    posted: results.reduce((n, r) => n + (r.posted ?? 0), 0),
    patched: results.reduce((n, r) => n + (r.patched ?? 0), 0),
    deleted: results.reduce((n, r) => n + (r.deleted ?? 0), 0),
    results,
  })
}
