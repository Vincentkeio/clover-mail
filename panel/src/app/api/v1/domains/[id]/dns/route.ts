import { NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { dnsRecords, domains } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getMailHostname, getPanelSettings, getVpsIp } from '@/lib/settings'
import { resolveDkimPublicKey } from '@/lib/dkim'
import { generateDnsRecords, type DnsRecordSpec } from '@/lib/dns-generator'
import { getTranslator } from '@/lib/i18n/server'
import type { Translator } from '@/lib/i18n/translate'

export const dynamic = 'force-dynamic'

async function loadDomain(id: number) {
  const [row] = await db.select().from(domains).where(eq(domains.id, id)).limit(1)
  return row ?? null
}

/** 依据域 + 全局设置生成记录规格 */
async function buildSpecs(domain: { id: number; name: string; mailHostname: string | null; ownershipToken: string | null }, t: Translator) {
  const [vpsIp, panel, dkimPublicKey] = await Promise.all([
    getVpsIp(),
    getPanelSettings(),
    resolveDkimPublicKey(domain.id, domain.name, t),
  ])
  return generateDnsRecords({
    domain: domain.name,
    mailHostname: getMailHostname(domain.mailHostname ?? `mail.${domain.name}`),
    ownershipToken: domain.ownershipToken ?? 'clover-verification=<pending>',
    vpsIp: vpsIp || '203.0.113.10', // 未设置时用文档保留段占位，UI 会提示
    dkimPublicKey,
    dmarcPolicy: panel.dmarcPolicy,
    spfStrict: panel.spfStrict,
    advanced: panel.advancedDns,
  }, t)
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const t = await getTranslator()
  const id = Number((await ctx.params).id)
  const domain = await loadDomain(id)
  if (!domain) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [rows, specs, panel] = await Promise.all([
    db.select().from(dnsRecords).where(eq(dnsRecords.domainId, id)).orderBy(asc(dnsRecords.id)),
    buildSpecs(domain, t),
    getPanelSettings(),
  ])

  let checklist: unknown = null
  if (domain.dnsStatus) {
    try {
      checklist = JSON.parse(domain.dnsStatus)
    } catch {
      checklist = null
    }
  }

  return NextResponse.json({
    domain,
    records: rows,
    generated: specs,
    checklist,
    settings: { vpsIp: panel.vpsIp, dmarcPolicy: panel.dmarcPolicy, spfStrict: panel.spfStrict, advancedDns: panel.advancedDns },
  })
}

/** 生成/刷新记录（入库；幂等，可重复点） */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const t = await getTranslator()
  const id = Number((await ctx.params).id)
  const domain = await loadDomain(id)
  if (!domain) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const specs = await buildSpecs(domain, t)

  // 重建式刷新：本地行仅作展示/导出载体，推送时以 CF 现状实时 diff
  await db.delete(dnsRecords).where(eq(dnsRecords.domainId, id))
  if (specs.length > 0) {
    await db.insert(dnsRecords).values(
      specs.map((s: DnsRecordSpec) => ({
        domainId: id,
        type: s.type,
        name: s.name,
        content: s.content,
        priority: s.priority ?? null,
        ttl: s.ttl,
        comment: s.cloverTag,
        status: 'planned',
      })),
    )
  }
  await audit(admin.username, 'dns.generate', domain.name, { count: specs.length, dkim: specs.some((s) => s.cloverTag === 'clover-dkim') })
  return NextResponse.json({ ok: true, count: specs.length })
}
