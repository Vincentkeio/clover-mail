/**
 * DNS 生效检测（M2 checklist 自动打勾）。
 * plan 里写的 dig 在本机/容器里未必有，改用 DNS-over-HTTPS（dns.google）
 * 拿同等数据 —— 跨平台、无外部依赖。
 * 注意：Node 原生 fetch 不走系统代理，直连 dns.google 在代理网络下必超时，
 * 因此统一走 curl 子进程（自动读取 https_proxy 环境变量）。
 */

import { execFile } from 'node:child_process'
import { isIPv4 } from 'node:net'
import { promisify } from 'node:util'
import { DEFAULT_LOCALE } from './i18n/config'
import { createTranslator, type Translator } from './i18n/translate'

const execFileAsync = promisify(execFile)

/** 调用方未传 Translator 时的兜底（默认语言），避免漏改调用点时丢文案。 */
const fallbackTranslator = createTranslator(DEFAULT_LOCALE)

type DoHAnswer = { name: string; type: number; TTL: number; data: string }

async function queryResolver(endpoint: string, name: string, type: string, t: Translator): Promise<DoHAnswer[]> {
  const url = `${endpoint}?name=${encodeURIComponent(name)}&type=${type}`
  let out: string
  try {
    const r = await execFileAsync('curl', ['-fsS', '--max-time', '8', '-H', 'accept: application/dns-json', url], {
      timeout: 12000,
      maxBuffer: 1024 * 1024,
    })
    out = r.stdout
  } catch (err) {
    throw new Error(t('apiErrors.dns.queryNetworkUnreachable', { error: err instanceof Error ? err.message : String(err) }))
  }
  let data: { Status: number; Answer?: DoHAnswer[] }
  try {
    data = JSON.parse(out)
  } catch {
    throw new Error(t('apiErrors.dns.queryUnexpected'))
  }
  if (data.Status === 3) return [] // NXDOMAIN is a missing name, not a network failure.
  if (data.Status !== 0) throw new Error(t('apiErrors.dns.resolverFailed', { status: data.Status }))
  return data.Answer ?? []
}

export async function dohQuery(name: string, type: 'A' | 'TXT' | 'MX' | 'CNAME' | 'PTR', t: Translator = fallbackTranslator): Promise<DoHAnswer[]> {
  const recordType = { A: 1, TXT: 16, MX: 15, CNAME: 5, PTR: 12 }[type]
  let answered = false
  let failure: unknown
  for (const endpoint of ['https://dns.google/resolve', 'https://cloudflare-dns.com/dns-query']) {
    try {
      const answers = await queryResolver(endpoint, name, type, t)
      answered = true
      if (answers.some((answer) => answer.type === recordType)) return answers
    } catch (error) { failure = error }
  }
  if (answered) return []
  throw failure instanceof Error ? failure : new Error(t('apiErrors.dns.queryFailed'))
}

/** Join character strings within one TXT RR, never across separate records. */
function txtContent(data: string, t: Translator): string {
  if (!data.startsWith('"')) return data
  const strings = /"((?:\\[\s\S]|[^"\\])*)"/g
  const chunks = [...data.matchAll(strings)]
  if (!chunks.length || data.replace(strings, '').trim()) throw new Error(t('apiErrors.dns.txtFormatInvalid'))
  const bytes: number[] = []
  for (const chunk of chunks) {
    const value = chunk[1]
    for (let i = 0; i < value.length;) {
      if (value[i] === '\\') {
        const decimal = value.slice(i + 1, i + 4)
        if (/^\d{3}$/.test(decimal)) {
          const byte = Number(decimal)
          if (byte > 255) throw new Error(t('apiErrors.dns.txtEscapeInvalid'))
          bytes.push(byte); i += 4; continue
        }
        i++
      }
      const character = String.fromCodePoint(value.codePointAt(i)!)
      bytes.push(...Buffer.from(character, 'utf8')); i += character.length
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/** TXT records remain independent regardless of resolver answer ordering. */
export async function resolveTxt(name: string, t: Translator = fallbackTranslator): Promise<string[]> {
  const answers = await dohQuery(name, 'TXT', t)
  return answers.filter((answer) => answer.type === 16).map((answer) => txtContent(answer.data, t))
}

export async function resolveA(name: string, t: Translator = fallbackTranslator): Promise<string[]> {
  return (await dohQuery(name, 'A', t)).filter((a) => a.type === 1).map((a) => a.data)
}

export async function resolvePtr(ip: string, t: Translator = fallbackTranslator): Promise<string[]> {
  if (!isIPv4(ip.trim())) return []
  const reversed = ip.trim().split('.').reverse().join('.') + '.in-addr.arpa'
  return (await dohQuery(reversed, 'PTR', t)).filter((a) => a.type === 12).map((a) => a.data.replace(/\.$/, '').toLowerCase())
}

export async function resolveMx(name: string, t: Translator = fallbackTranslator): Promise<Array<{ priority: number; host: string }>> {
  return (await dohQuery(name, 'MX', t)).filter((a) => a.type === 15).map((a) => {
    const [priority, host] = a.data.split(' ')
    return { priority: Number(priority), host }
  })
}

export type CheckItem = {
  key: string
  label: string
  ok: boolean
  expected: string
  actual: string
}

/** 按 checklist 逐项探测；全部失败时返回单条网络错误而非一屏误导性的「未通过」 */
export async function runChecklist(opts: {
  domain: string
  mailHostname: string
  ownershipToken: string
  vpsIp: string
  dkimPublicKey?: string | null
}, t: Translator = fallbackTranslator): Promise<CheckItem[]> {
  const { domain, mailHostname, ownershipToken, vpsIp, dkimPublicKey } = opts
  const checks: Array<() => Promise<CheckItem>> = []
  const failures: string[] = []
  const txtLookups = new Map<string, Promise<string[]>>()
  const txtRecords = (name: string) => {
    if (!txtLookups.has(name)) txtLookups.set(name, resolveTxt(name, t))
    return txtLookups.get(name)!
  }

  const addCheck = (fn: () => Promise<CheckItem>) => { checks.push(fn) }

  addCheck(async () => {
    const txts = await txtRecords(domain)
    const hit = txts.some((t) => t.includes(ownershipToken))
    return { key: 'ownership', label: t('apiErrors.checkItem.ownership'), ok: hit, expected: ownershipToken, actual: txts.join(' | ') || t('apiErrors.dns.empty') }
  })
  addCheck(async () => {
    const mxs = await resolveMx(domain, t)
    const hit = mxs.some((m) => m.host.replace(/\.$/, '').toLowerCase() === mailHostname.replace(/\.$/, '').toLowerCase())
    return {
      key: 'mx',
      label: t('apiErrors.checkItem.mx'),
      ok: hit,
      expected: t('apiErrors.dns.mxExpected', { host: mailHostname }),
      actual: mxs.map((m) => `${m.host}(${m.priority})`).join(' | ') || t('apiErrors.dns.empty'),
    }
  })
  addCheck(async () => {
    const ips = await resolveA(mailHostname, t)
    const hit = ips.includes(vpsIp)
    return { key: 'mail-a', label: t('apiErrors.checkItem.mail-a'), ok: hit, expected: vpsIp, actual: ips.join(' | ') || t('apiErrors.dns.empty') }
  })
  addCheck(async () => {
    const txts = await txtRecords(domain)
    const spfs = txts.filter((t) => /^v=spf1(?:\s|$)/i.test(t.trim()))
    const spf = spfs[0]
    const unique = spfs.length === 1
    const authorizesIp = !!spf && spf.includes(`ip4:${vpsIp}`)
    const actual = spfs.length
      ? spfs.map((record, index) => `${index + 1}. ${record}`).join(' | ')
      : t('apiErrors.dns.spfNotFound')
    const reason = spfs.length > 1
      ? t('apiErrors.dns.spfMultiple', { count: spfs.length, actual })
      : spfs.length === 0
        ? actual
        : authorizesIp
          ? spf!
          : t('apiErrors.dns.spfMissingIp', { record: spf!, ip: vpsIp })
    return {
      key: 'spf',
      label: spfs.length > 1 ? t('apiErrors.checkItem.spfDuplicate') : t('apiErrors.checkItem.spf'),
      ok: unique && authorizesIp,
      expected: t('apiErrors.dns.spfExpected', { ip: vpsIp }),
      actual: reason,
    }
  })
  if (dkimPublicKey) {
    addCheck(async () => {
      const txts = await txtRecords(`mail._domainkey.${domain}`)
      const hit = txts.some((t) => t.includes(dkimPublicKey.slice(0, 40)))
      return {
        key: 'dkim',
        label: t('apiErrors.checkItem.dkim'),
        ok: hit,
        expected: `${dkimPublicKey.slice(0, 40)}…`,
        actual: txts.map((t) => t.slice(0, 60)).join(' | ') || t('apiErrors.dns.empty'),
      }
    })
  }
  addCheck(async () => {
    const txts = await txtRecords(`_dmarc.${domain}`)
    const dmarc = txts.find((t) => /^v=DMARC1(?:\s|;|$)/i.test(t.trim()))
    return { key: 'dmarc', label: t('apiErrors.checkItem.dmarc'), ok: !!dmarc, expected: 'v=DMARC1; …', actual: dmarc ?? t('apiErrors.dns.empty') }
  })

  const outcomes = await Promise.all(checks.map(async (check) => {
    try { return await check() }
    catch (error) { failures.push(error instanceof Error ? error.message : String(error)); return null }
  }))
  const results = outcomes.filter((item): item is CheckItem => item !== null)
  if (results.length === 0) {
    return [
      {
        key: 'network',
        label: t('apiErrors.checkItem.network'),
        ok: false,
        expected: t('apiErrors.dns.networkExpected'),
        actual: failures[0] ?? t('apiErrors.dns.networkUnreachable'),
      },
    ]
  }
  if (failures.length > 0) {
    results.push({
      key: 'network',
      label: t('apiErrors.checkItem.networkPartial', { count: failures.length }),
      ok: false,
      expected: '',
      actual: failures[0],
    })
  }
  return results
}
