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

const execFileAsync = promisify(execFile)

type DoHAnswer = { name: string; type: number; TTL: number; data: string }

async function queryResolver(endpoint: string, name: string, type: string): Promise<DoHAnswer[]> {
  const url = `${endpoint}?name=${encodeURIComponent(name)}&type=${type}`
  let out: string
  try {
    const r = await execFileAsync('curl', ['-fsS', '--max-time', '8', '-H', 'accept: application/dns-json', url], {
      timeout: 12000,
      maxBuffer: 1024 * 1024,
    })
    out = r.stdout
  } catch (err) {
    throw new Error(`DNS 查询网络不可达（${err instanceof Error ? err.message : String(err)}）`)
  }
  let data: { Status: number; Answer?: DoHAnswer[] }
  try {
    data = JSON.parse(out)
  } catch {
    throw new Error('DNS 查询返回了非预期内容')
  }
  if (data.Status === 3) return [] // NXDOMAIN is a missing name, not a network failure.
  if (data.Status !== 0) throw new Error(`DNS 解析器查询失败（状态 ${data.Status}），请稍后重试`)
  return data.Answer ?? []
}

export async function dohQuery(name: string, type: 'A' | 'TXT' | 'MX' | 'CNAME' | 'PTR'): Promise<DoHAnswer[]> {
  const recordType = { A: 1, TXT: 16, MX: 15, CNAME: 5, PTR: 12 }[type]
  let answered = false
  let failure: unknown
  for (const endpoint of ['https://dns.google/resolve', 'https://cloudflare-dns.com/dns-query']) {
    try {
      const answers = await queryResolver(endpoint, name, type)
      answered = true
      if (answers.some((answer) => answer.type === recordType)) return answers
    } catch (error) { failure = error }
  }
  if (answered) return []
  throw failure instanceof Error ? failure : new Error('DNS 查询失败，请稍后重试')
}

/** Join character strings within one TXT RR, never across separate records. */
function txtContent(data: string): string {
  if (!data.startsWith('"')) return data
  const strings = /"((?:\\[\s\S]|[^"\\])*)"/g
  const chunks = [...data.matchAll(strings)]
  if (!chunks.length || data.replace(strings, '').trim()) throw new Error('TXT 记录格式无效')
  const bytes: number[] = []
  for (const chunk of chunks) {
    const value = chunk[1]
    for (let i = 0; i < value.length;) {
      if (value[i] === '\\') {
        const decimal = value.slice(i + 1, i + 4)
        if (/^\d{3}$/.test(decimal)) {
          const byte = Number(decimal)
          if (byte > 255) throw new Error('TXT 记录转义无效')
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
export async function resolveTxt(name: string): Promise<string[]> {
  const answers = await dohQuery(name, 'TXT')
  return answers.filter((answer) => answer.type === 16).map((answer) => txtContent(answer.data))
}

export async function resolveA(name: string): Promise<string[]> {
  return (await dohQuery(name, 'A')).filter((a) => a.type === 1).map((a) => a.data)
}

export async function resolvePtr(ip: string): Promise<string[]> {
  if (!isIPv4(ip.trim())) return []
  const reversed = ip.trim().split('.').reverse().join('.') + '.in-addr.arpa'
  return (await dohQuery(reversed, 'PTR')).filter((a) => a.type === 12).map((a) => a.data.replace(/\.$/, '').toLowerCase())
}

export async function resolveMx(name: string): Promise<Array<{ priority: number; host: string }>> {
  return (await dohQuery(name, 'MX')).filter((a) => a.type === 15).map((a) => {
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
}): Promise<CheckItem[]> {
  const { domain, mailHostname, ownershipToken, vpsIp, dkimPublicKey } = opts
  const checks: Array<() => Promise<CheckItem>> = []
  const failures: string[] = []
  const txtLookups = new Map<string, Promise<string[]>>()
  const txtRecords = (name: string) => {
    if (!txtLookups.has(name)) txtLookups.set(name, resolveTxt(name))
    return txtLookups.get(name)!
  }

  const addCheck = (fn: () => Promise<CheckItem>) => { checks.push(fn) }

  addCheck(async () => {
    const txts = await txtRecords(domain)
    const hit = txts.some((t) => t.includes(ownershipToken))
    return { key: 'ownership', label: '归属 TXT', ok: hit, expected: ownershipToken, actual: txts.join(' | ') || '(空)' }
  })
  addCheck(async () => {
    const mxs = await resolveMx(domain)
    const hit = mxs.some((m) => m.host.replace(/\.$/, '').toLowerCase() === mailHostname.replace(/\.$/, '').toLowerCase())
    return {
      key: 'mx',
      label: 'MX 记录',
      ok: hit,
      expected: `${mailHostname}（优先级 10）`,
      actual: mxs.map((m) => `${m.host}(${m.priority})`).join(' | ') || '(空)',
    }
  })
  addCheck(async () => {
    const ips = await resolveA(mailHostname)
    const hit = ips.includes(vpsIp)
    return { key: 'mail-a', label: 'mail A 记录', ok: hit, expected: vpsIp, actual: ips.join(' | ') || '(空)' }
  })
  addCheck(async () => {
    const txts = await txtRecords(domain)
    const spf = txts.find((t) => t.startsWith('v=spf1'))
    const hit = !!spf && spf.includes(`ip4:${vpsIp}`)
    return { key: 'spf', label: 'SPF', ok: hit, expected: `v=spf1 … ip4:${vpsIp}`, actual: spf ?? '(空)' }
  })
  if (dkimPublicKey) {
    addCheck(async () => {
      const txts = await txtRecords(`mail._domainkey.${domain}`)
      const hit = txts.some((t) => t.includes(dkimPublicKey.slice(0, 40)))
      return {
        key: 'dkim',
        label: 'DKIM',
        ok: hit,
        expected: `${dkimPublicKey.slice(0, 40)}…`,
        actual: txts.map((t) => t.slice(0, 60)).join(' | ') || '(空)',
      }
    })
  }
  addCheck(async () => {
    const txts = await txtRecords(`_dmarc.${domain}`)
    const dmarc = txts.find((t) => t.startsWith('v=DMARC1'))
    return { key: 'dmarc', label: 'DMARC', ok: !!dmarc, expected: 'v=DMARC1; …', actual: dmarc ?? '(空)' }
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
        label: '检测失败',
        ok: false,
        expected: '可访问公网 DNS',
        actual: failures[0] ?? '网络不可达',
      },
    ]
  }
  if (failures.length > 0) {
    results.push({
      key: 'network',
      label: `另有 ${failures.length} 项查询失败`,
      ok: false,
      expected: '',
      actual: failures[0],
    })
  }
  return results
}
