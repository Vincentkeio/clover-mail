import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { getMailHostname, getPanelSettings, getVpsIp } from '@/lib/settings'
import { generateDnsRecords } from '@/lib/dns-generator'

export const dynamic = 'force-dynamic'

/**
 * 建域向导第二步的 DNS 预览：按设置生成记录（新域尚无 DKIM，DMS 未连接时同样没有）。
 */
export async function GET(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const domain = new URL(req.url).searchParams.get('domain') ?? ''
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i.test(domain.trim())) {
    return NextResponse.json({ error: '域名格式不正确' }, { status: 400 })
  }

  const [vpsIp, panel] = await Promise.all([getVpsIp(), getPanelSettings()])
  const specs = generateDnsRecords({
    domain: domain.trim().toLowerCase(),
    mailHostname: getMailHostname(`mail.${domain.trim().toLowerCase()}`),
    ownershipToken: 'clover-verification=<创建后自动生成>',
    vpsIp: vpsIp || '203.0.113.10',
    dkimPublicKey: null, // 新域 DKIM 由 DMS 建域后生成，向导提示后续补推
    dmarcPolicy: panel.dmarcPolicy,
    spfStrict: panel.spfStrict,
    advanced: panel.advancedDns,
  })

  return NextResponse.json({ domain, records: specs, vpsIp: vpsIp || null, mailHostname: getMailHostname(`mail.${domain.trim().toLowerCase()}`) })
}
