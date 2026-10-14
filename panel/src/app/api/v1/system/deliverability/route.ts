import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { getMailHostname, getVpsIp } from '@/lib/settings'
import { checkAllDnsbl, domainHealth } from '@/lib/dnsbl'

export const dynamic = 'force-dynamic'

/**
 * 投递体检：
 * ?ip=203.0.113.10（默认取设置里的 VPS IP）→ DNSBL 五家黑名单
 * ?domain=example.com（默认第一个域）→ 域健康五项
 */
export async function GET(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const url = new URL(req.url)
  const ip = url.searchParams.get('ip') || (await getVpsIp())
  const domainParam = url.searchParams.get('domain')

  let domain = null
  if (domainParam) {
    const [row] = await db.select().from(domains).where(eq(domains.name, domainParam)).limit(1)
    domain = row ?? null
  } else {
    const [row] = await db.select().from(domains).orderBy(domains.id).limit(1)
    domain = row ?? null
  }

  const [dnsbl, health] = await Promise.all([
    ip ? checkAllDnsbl(ip) : Promise.resolve(null),
    domain
      ? domainHealth(domain.name, getMailHostname(domain.mailHostname ?? `mail.${domain.name}`))
      : Promise.resolve(null),
  ])

  return NextResponse.json({
    ip: ip || null,
    domain: domain?.name ?? null,
    dnsbl,
    health,
  })
}
