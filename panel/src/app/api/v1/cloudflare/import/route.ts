import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { listAllZones } from '@/lib/cloudflare'
import { ensureDomain, ensureDomainRecords, pushDomainDns, type PushOutcome } from '@/lib/cf-sync'
import { getCfToken } from '@/lib/settings'
import { getTranslator } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

type ItemResult = { name: string; created: boolean; generated: number; push?: PushOutcome }

/**
 * 批量导入：把选中的 CF 域名在面板里建好 + 生成 DNS 记录 +（可选）立刻推送到 CF。
 * body: { names: string[] | "all", push?: boolean }
 */
export async function POST(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const t = await getTranslator()
  const token = await getCfToken()
  if (!token) {
    return NextResponse.json({ error: t('apiErrors.cloudflare.tokenMissing') }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const push = body?.push !== false // 默认导入即推送
  const wantAll = body?.names === 'all'
  let names: string[] = wantAll ? [] : (Array.isArray(body?.names) ? body.names.map((n: unknown) => String(n)) : [])

  if (wantAll) {
    try {
      const zones = await listAllZones(token, t)
      names = zones.map((z) => z.name)
    } catch (err) {
      return NextResponse.json({ error: t('apiErrors.cloudflare.fetchZonesFailed', { error: err instanceof Error ? err.message : String(err) }) }, { status: 502 })
    }
  }

  if (names.length === 0) {
    return NextResponse.json({ error: t('apiErrors.cloudflare.noDomains') }, { status: 400 })
  }

  const results: ItemResult[] = []
  for (const raw of names) {
    const name = String(raw).trim().toLowerCase()
    try {
      const { created, row } = await ensureDomain(name)
      const generated = await ensureDomainRecords(row, t)
      const result: ItemResult = { name, created, generated }
      if (push) result.push = await pushDomainDns(row, token, t)
      results.push(result)
    } catch (err) {
      results.push({
        name,
        created: false,
        generated: 0,
        push: { domain: name, ok: false, error: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  const okCount = results.filter((r) => !r.push || r.push.ok).length
  await audit(admin.username, 'cloudflare.import', t('apiErrors.cloudflare.auditTarget', { count: results.length }), {
    push,
    ok: okCount,
    failed: results.length - okCount,
  })
  return NextResponse.json({ total: results.length, ok: okCount, results })
}
