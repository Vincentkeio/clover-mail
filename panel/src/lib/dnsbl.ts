/**
 * 投递体检（M3）。
 * DNSBL checks distinguish provider listing codes from query errors.
 * Public DoH restrictions mean some results must remain unknown.
 */

import { isIPv4 } from 'node:net'
import { dohQuery, resolveA, resolveMx, resolveTxt } from './dns-check'

export type DnsblResult = {
  zone: string
  label: string
  listed: boolean
  status: 'listed' | 'not-listed' | 'restricted' | 'error'
  detail?: string
  error?: string
}

export const DNSBL_ZONES: Array<{ zone: string; label: string; codes: string[] }> = [
  { zone: 'zen.spamhaus.org', label: 'Spamhaus ZEN', codes: ['127.0.0.2', '127.0.0.3', '127.0.0.4', '127.0.0.9', '127.0.0.10', '127.0.0.11'] },
  { zone: 'b.barracudacentral.org', label: 'Barracuda', codes: ['127.0.0.2'] },
  { zone: 'bl.spamcop.net', label: 'SpamCop', codes: ['127.0.0.2'] },
  // SORBS retired its service in June 2024; an empty answer is no health check.
  { zone: 'psbl.surriel.com', label: 'PSBL', codes: ['127.0.0.2'] },
]

function reverseIp(ip: string): string | null {
  const parts = ip.trim().split('.')
  if (!isIPv4(ip.trim())) return null
  return [...parts].reverse().join('.')
}

/** 单 DNSBL 查询；网络错误与「未命中」区分开 */
export async function checkDnsbl(ip: string, zone: string): Promise<DnsblResult> {
  const definition = DNSBL_ZONES.find((item) => item.zone === zone)
  const label = definition?.label ?? zone
  const reversed = reverseIp(ip)
  if (!reversed) {
    return { zone, label, listed: false, status: 'error', error: 'IP 格式不正确' }
  }
  if (!definition) return { zone, label, listed: false, status: 'error', error: '该 DNSBL 不在支持列表中' }
  try {
    const answers = await dohQuery(`${reversed}.${zone}`, 'A')
    const codes = [...new Set(answers.filter((answer) => answer.type === 1).map((answer) => answer.data))]
    const known = codes.filter((code) => definition.codes.includes(code))
    if (known.length) {
      return { zone, label, listed: true, status: 'listed', detail: `名单返回有效命中码：${known.join(', ')}` }
    }
    if (codes.includes('127.255.255.254') || codes.includes('127.255.255.255')) {
      return { zone, label, listed: false, status: 'restricted', detail: `返回 ${codes.join(', ')}`,
        error: '名单限制公共解析器查询或请求频率；本次无法判断是否收录，请到名单官网核验。' }
    }
    if (codes.length) return { zone, label, listed: false, status: 'error', detail: `返回 ${codes.join(', ')}`,
      error: codes.includes('127.255.255.252') ? 'DNSBL 查询名称配置错误，不能判断是否收录。' : '名单返回未识别的响应码，不能判断是否收录。' }
    // Spamhaus can also return NXDOMAIN to blocked public resolvers. Since
    // this application queries via public DoH, absence is not proof of clean IP.
    if (zone === 'zen.spamhaus.org') return { zone, label, listed: false, status: 'restricted',
      error: '公共解析器未返回可验证的 Spamhaus 结果；不能据此认定未收录，请到 Spamhaus 官网核验。' }
    return { zone, label, listed: false, status: 'not-listed', detail: '本次查询未返回有效命中记录。' }
  } catch (err) {
    return { zone, label, listed: false, status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

export async function checkAllDnsbl(ip: string): Promise<{ ip: string; results: DnsblResult[]; reachable: boolean }> {
  const results = await Promise.all(DNSBL_ZONES.map(({ zone }) => checkDnsbl(ip, zone)))
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
    const spfs = txts.filter((t) => /^v=spf1(?:\s|$)/i.test(t.trim()))
    const ok = spfs.length === 1
    const detail = spfs.length === 0
      ? '未找到 SPF 记录'
      : spfs.length > 1
        ? `发现 ${spfs.length} 条 SPF 记录；同一域名只能发布一条。${spfs.join(' | ')}`
        : `DNS 中发现一条 SPF 记录：${spfs[0]}（未验证完整 SPF 语法或真实邮件认证）`
    return { key: 'spf', label: spfs.length > 1 ? 'SPF 记录重复' : 'SPF 单记录检查', ok, detail }
  })
  await safe(async () => {
    const txts = await resolveTxt(`mail._domainkey.${domain}`)
    return { key: 'dkim', label: 'DKIM 公钥存在', ok: txts.length > 0, detail: txts[0]?.slice(0, 60) ?? '未找到 DKIM TXT' }
  })
  await safe(async () => {
    const txts = await resolveTxt(`_dmarc.${domain}`)
    const dmarc = txts.find((t) => /^v=DMARC1(?:\s|;|$)/i.test(t.trim()))
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
