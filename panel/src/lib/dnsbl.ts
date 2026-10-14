/**
 * 投递体检（M3）。
 * 黑名单走 DNSBL 标准查询协议：反转 IP + DNSBL 域名做 A 记录查询（127.0.0.2 = 命中）。
 * 全部经 DoH（dns.google）完成，无需 MXToolbox API key；如需官方报告，
 * 可在设置页配 MXToolbox key 后扩展（TODO，不外放第三方 key 到无 key 降级路径之外）。
 */

import { dohQuery, resolveA, resolveMx, resolveTxt } from './dns-check'

export type DnsblResult = {
  zone: string
  label: string
  listed: boolean
  detail?: string
  error?: string
}

export const DNSBL_ZONES: Array<{ zone: string; label: string }> = [
  { zone: 'zen.spamhaus.org', label: 'Spamhaus ZEN' },
  { zone: 'b.barracudacentral.org', label: 'Barracuda' },
  { zone: 'bl.spamcop.net', label: 'SpamCop' },
  { zone: 'dnsbl.sorbs.net', label: 'SORBS' },
  { zone: 'psbl.surriel.com', label: 'PSBL' },
]

function reverseIp(ip: string): string | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null
  return [...parts].reverse().join('.')
}

/** 单 DNSBL 查询；网络错误与「未命中」区分开 */
export async function checkDnsbl(ip: string, zone: string): Promise<DnsblResult> {
  const reversed = reverseIp(ip)
  if (!reversed) {
    return { zone, label: zone, listed: false, error: 'IP 格式不正确' }
  }
  try {
    const answers = await dohQuery(`${reversed}.${zone}`, 'A')
    if (answers.length === 0) {
      return { zone, label: zone, listed: false }
    }
    const codes = answers.map((a) => a.data).join(',')
    return { zone, label: zone, listed: true, detail: `返回 ${codes}（127.0.0.2/4 等表示命中）` }
  } catch (err) {
    return { zone, label: zone, listed: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function checkAllDnsbl(ip: string): Promise<{ ip: string; results: DnsblResult[]; reachable: boolean }> {
  const results: DnsblResult[] = []
  for (const { zone, label } of DNSBL_ZONES) {
    results.push({ ...(await checkDnsbl(ip, zone)), label })
  }
  return { ip, results, reachable: results.some((r) => !r.error) }
}

export type DomainHealth = {
  domain: string
  mailHostname: string
  items: Array<{ key: string; label: string; ok: boolean; detail: string }>
};

/** 域健康速览（不依赖 settings 的 vpsIp：MX/A 存在性 + SPF/DKIM/DMARC 存在性） */
export async function domainHealth(domain: string, mailHostname: string): Promise<DomainHealth> {
  const items: DomainHealth['items'] = []
  const failures: string[] = []
  const safe = async (fn: () => Promise<{ key: string; label: string; ok: boolean; detail: string }>) => {
    try {
      items.push(await fn())
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err))
    }
  }

  await safe(async () => {
    const mxs = await resolveMx(domain)
    const ok = mxs.some((m) => m.host.replace(/\.$/, '').toLowerCase() === mailHostname.toLowerCase())
    return {
      key: 'mx',
      label: 'MX 指向邮件主机',
      ok,
      detail: mxs.map((m) => `${m.host}(${m.priority})`).join(' | ') || '无 MX 记录',
    }
  })
  await safe(async () => {
    const ips = await resolveA(mailHostname)
    return { key: 'mail-a', label: `${mailHostname} 有 A 记录`, ok: ips.length > 0, detail: ips.join(' | ') || '无 A 记录' }
  })
  await safe(async () => {
    const txts = await resolveTxt(domain)
    const spf = txts.find((t) => t.startsWith('v=spf1'))
    return { key: 'spf', label: 'SPF 记录存在', ok: !!spf, detail: spf ?? '未找到 v=spf1 记录' }
  })
  await safe(async () => {
    const txts = await resolveTxt(`mail._domainkey.${domain}`)
    return { key: 'dkim', label: 'DKIM 公钥存在', ok: txts.length > 0, detail: txts[0]?.slice(0, 60) ?? '未找到 DKIM TXT' }
  })
  await safe(async () => {
    const txts = await resolveTxt(`_dmarc.${domain}`)
    const dmarc = txts.find((t) => t.startsWith('v=DMARC1'))
    return { key: 'dmarc', label: 'DMARC 记录存在', ok: !!dmarc, detail: dmarc ?? '未找到 DMARC TXT' }
  })

  if (items.length === 0) {
    return {
      domain,
      mailHostname,
      items: [
        {
          key: 'network',
          label: '检测失败',
          ok: false,
          detail: failures[0] ?? 'DNS 查询网络不可达',
        },
      ],
    }
  }
  if (failures.length > 0) {
    items.push({ key: 'network', label: `另有 ${failures.length} 项查询失败`, ok: false, detail: failures[0] })
  }
  return { domain, mailHostname, items }
}
