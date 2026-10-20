/**
 * 投递体检（M3）。
 * DNSBL checks distinguish provider listing codes from query errors.
 * Public DoH restrictions mean some results must remain unknown.
 */

import { isIPv4 } from 'node:net'
import { dohQuery, resolveA, resolveMx, resolveTxt } from './dns-check'
import { createTranslator, type Translator } from '@/lib/i18n/translate'

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
export async function checkDnsbl(ip: string, zone: string, t: Translator = createTranslator('en')): Promise<DnsblResult> {
  const definition = DNSBL_ZONES.find((item) => item.zone === zone)
  const label = definition?.label ?? zone
  const reversed = reverseIp(ip)
  if (!reversed) {
    return { zone, label, listed: false, status: 'error', error: t('apiSystem.deliverability.ipInvalid') }
  }
  if (!definition) return { zone, label, listed: false, status: 'error', error: t('apiSystem.deliverability.unsupportedZone') }
  try {
    const answers = await dohQuery(`${reversed}.${zone}`, 'A')
    const codes = [...new Set(answers.filter((answer) => answer.type === 1).map((answer) => answer.data))]
    const known = codes.filter((code) => definition.codes.includes(code))
    if (known.length) {
      return { zone, label, listed: true, status: 'listed', detail: t('apiSystem.deliverability.listedDetail', { codes: known.join(', ') }) }
    }
    if (codes.includes('127.255.255.254') || codes.includes('127.255.255.255')) {
      return { zone, label, listed: false, status: 'restricted', detail: t('apiSystem.deliverability.returnedCodes', { codes: codes.join(', ') }),
        error: t('apiSystem.deliverability.restrictedByResolver') }
    }
    if (codes.length) return { zone, label, listed: false, status: 'error', detail: t('apiSystem.deliverability.returnedCodes', { codes: codes.join(', ') }),
      error: codes.includes('127.255.255.252') ? t('apiSystem.deliverability.queryNameInvalid') : t('apiSystem.deliverability.unknownCode') }
    // Spamhaus can also return NXDOMAIN to blocked public resolvers. Since
    // this application queries via public DoH, absence is not proof of clean IP.
    if (zone === 'zen.spamhaus.org') return { zone, label, listed: false, status: 'restricted',
      error: t('apiSystem.deliverability.spamhausUnverifiable') }
    return { zone, label, listed: false, status: 'not-listed', detail: t('apiSystem.deliverability.notListedDetail') }
  } catch (err) {
    return { zone, label, listed: false, status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

export async function checkAllDnsbl(ip: string, t: Translator = createTranslator('en')): Promise<{ ip: string; results: DnsblResult[]; reachable: boolean }> {
  const results = await Promise.all(DNSBL_ZONES.map(({ zone }) => checkDnsbl(ip, zone, t)))
  return { ip, results, reachable: results.some((r) => !r.error) }
}

export type DomainHealth = {
  domain: string
  mailHostname: string
  items: Array<{ key: string; label: string; ok: boolean; detail: string }>
};

/** 域健康速览（不依赖 settings 的 vpsIp：MX/A 存在性 + SPF/DKIM/DMARC 存在性） */
export async function domainHealth(domain: string, mailHostname: string, t: Translator = createTranslator('en')): Promise<DomainHealth> {
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
      label: t('apiSystem.deliverability.mxLabel'),
      ok,
      detail: mxs.map((m) => `${m.host}(${m.priority})`).join(' | ') || t('apiSystem.deliverability.noMx'),
    }
  })
  await safe(async () => {
    const ips = await resolveA(mailHostname)
    return { key: 'mail-a', label: t('apiSystem.deliverability.aRecordLabel', { host: mailHostname }), ok: ips.length > 0, detail: ips.join(' | ') || t('apiSystem.deliverability.noA') }
  })
  await safe(async () => {
    const txts = await resolveTxt(domain)
    const spfs = txts.filter((txt) => /^v=spf1(?:\s|$)/i.test(txt.trim()))
    const ok = spfs.length === 1
    const detail = spfs.length === 0
      ? t('apiSystem.deliverability.noSpf')
      : spfs.length > 1
        ? t('apiSystem.deliverability.spfMultiple', { count: spfs.length, records: spfs.join(' | ') })
        : t('apiSystem.deliverability.spfFound', { record: spfs[0] })
    return { key: 'spf', label: spfs.length > 1 ? t('apiSystem.deliverability.spfDuplicateLabel') : t('apiSystem.deliverability.spfSingleLabel'), ok, detail }
  })
  await safe(async () => {
    const txts = await resolveTxt(`mail._domainkey.${domain}`)
    return { key: 'dkim', label: t('apiSystem.deliverability.dkimLabel'), ok: txts.length > 0, detail: txts[0]?.slice(0, 60) ?? t('apiSystem.deliverability.noDkim') }
  })
  await safe(async () => {
    const txts = await resolveTxt(`_dmarc.${domain}`)
    const dmarc = txts.find((txt) => /^v=DMARC1(?:\s|;|$)/i.test(txt.trim()))
    return { key: 'dmarc', label: t('apiSystem.deliverability.dmarcLabel'), ok: !!dmarc, detail: dmarc ?? t('apiSystem.deliverability.noDmarc') }
  })

  if (items.length === 0) {
    return {
      domain,
      mailHostname,
      items: [
        {
          key: 'network',
          label: t('apiSystem.deliverability.checkFailedLabel'),
          ok: false,
          detail: failures[0] ?? t('apiSystem.deliverability.dnsUnreachable'),
        },
      ],
    }
  }
  if (failures.length > 0) {
    items.push({ key: 'network', label: t('apiSystem.deliverability.otherFailures', { count: failures.length }), ok: false, detail: failures[0] })
  }
  return { domain, mailHostname, items }
}
