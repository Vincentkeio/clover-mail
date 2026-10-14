import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getMailHostname, getVpsIp } from '@/lib/settings'
import { resolveDkimPublicKey } from '@/lib/dkim'
import { runChecklist } from '@/lib/dns-check'

export const dynamic = 'force-dynamic'

/** 公网 DNS 检测：逐项打勾并写回 domains.dns_status */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const id = Number((await ctx.params).id)
  const [domain] = await db.select().from(domains).where(eq(domains.id, id)).limit(1)
  if (!domain) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [vpsIp, dkimPublicKey] = await Promise.all([
    getVpsIp(),
    resolveDkimPublicKey(id, domain.name),
  ])
  if (!vpsIp) {
    return NextResponse.json({ error: '未设置 VPS IP（设置页），A/SPF 检测会失准' }, { status: 400 })
  }

  const items = await runChecklist({
    domain: domain.name,
    mailHostname: getMailHostname(domain.mailHostname ?? `mail.${domain.name}`),
    ownershipToken: domain.ownershipToken ?? '',
    vpsIp,
    dkimPublicKey,
  })

  await db
    .update(domains)
    .set({ dnsStatus: JSON.stringify({ items, checkedAt: new Date().toISOString() }) })
    .where(eq(domains.id, id))
  await audit(admin.username, 'dns.check', domain.name, { passed: items.filter((i) => i.ok).length, total: items.length })

  return NextResponse.json({ items })
}
