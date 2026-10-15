import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { getMailHostname, getPanelSettings, getVpsIp } from '@/lib/settings'
import { resolveDkimPublicKey } from '@/lib/dkim'
import { exportBind, exportPlain, generateDnsRecords } from '@/lib/dns-generator'

export const dynamic = 'force-dynamic'

/** Both .bind and .txt downloads use importable BIND zone syntax. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const id = Number((await ctx.params).id)
  const [domain] = await db.select().from(domains).where(eq(domains.id, id)).limit(1)
  if (!domain) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [vpsIp, panel, dkimPublicKey] = await Promise.all([
    getVpsIp(),
    getPanelSettings(),
    resolveDkimPublicKey(id, domain.name),
  ])

  const specs = generateDnsRecords({
    domain: domain.name,
    mailHostname: getMailHostname(domain.mailHostname ?? `mail.${domain.name}`),
    ownershipToken: domain.ownershipToken ?? '',
    vpsIp: vpsIp || '203.0.113.10',
    dkimPublicKey,
    dmarcPolicy: panel.dmarcPolicy,
    spfStrict: panel.spfStrict,
    advanced: panel.advancedDns,
  })

  const format = new URL(req.url).searchParams.get('format') ?? 'text'
  if (!['bind', 'text'].includes(format)) return NextResponse.json({ error: '导出格式无效' }, { status: 400 })
  const filename = format === 'bind' ? `${domain.name}.bind` : `${domain.name}-dns.txt`
  const body = format === 'bind' ? exportBind(domain.name, specs) : exportPlain(domain.name, specs)
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
