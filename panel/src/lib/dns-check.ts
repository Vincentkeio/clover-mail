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

export async function dohQuery(name: string, type: 'A' | 'TXT' | 'MX' | 'CNAME' | 'PTR'): Promise<DoHAnswer[]> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`
  let out: string
  try {
    const r = await execFileAsync('curl', ['-s', '--max-time', '8', url], {
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
  if (data.Status !== 0) return [] // NXDOMAIN / SERVFAIL 等
  return data.Answer ?? []
}

/** TXT 记录（自动拼接分片） */
export async function resolveTxt(name: string): Promise<string[]> {
  const answers = await dohQuery(name, 'TXT')
  const byKey = new Map<string, string[]>()
  for (const a of answers) {
    const chunk = a.data.replace(/^"|"$/g, '')
    const list = byKey.get(a.name) ?? []
    list.push(chunk)
    byKey.set(a.name, list)
  }
  return [...byKey.values()].map((chunks) => chunks.join(''))
}

export async function resolveA(name: string): Promise<string[]> {
  return (await dohQuery(name, 'A')).map((a) => a.data)
}

export async function resolvePtr(ip: string): Promise<string[]> {
  if (!isIPv4(ip.trim())) return []
  const reversed = ip.trim().split('.').reverse().join('.') + '.in-addr.arpa'
  return (await dohQuery(reversed, 'PTR')).map((a) => a.data.replace(/\.$/, '').toLowerCase())
}

export async function resolveMx(name: string): Promise<Array<{ priority: number; host: string }>> {
  return (await dohQuery(name, 'MX')).map((a) => {
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
  const results: CheckItem[] = []
  const failures: string[] = []

  const safe = async (fn: () => Promise<CheckItem>) => {
    try {
      results.push(await fn())
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err))
    }
  }

  await safe(async () => {
    const txts = await resolveTxt(domain)
    const hit = txts.some((t) => t.includes(ownershipToken))
    return { key: 'ownership', label: '归属 TXT', ok: hit, expected: ownershipToken, actual: txts.join(' | ') || '(空)' }
  })
  await safe(async () => {
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
  await safe(async () => {
    const ips = await resolveA(mailHostname)
    const hit = ips.includes(vpsIp)
    return { key: 'mail-a', label: 'mail A 记录', ok: hit, expected: vpsIp, actual: ips.join(' | ') || '(空)' }
  })
  await safe(async () => {
    const txts = await resolveTxt(domain)
    const spf = txts.find((t) => t.startsWith('v=spf1'))
    const hit = !!spf && spf.includes(`ip4:${vpsIp}`)
    return { key: 'spf', label: 'SPF', ok: hit, expected: `v=spf1 … ip4:${vpsIp}`, actual: spf ?? '(空)' }
  })
  if (dkimPublicKey) {
    await safe(async () => {
      const txts = await resolveTxt(`mail._domainkey.${domain}`)
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
  await safe(async () => {
    const txts = await resolveTxt(`_dmarc.${domain}`)
    const dmarc = txts.find((t) => t.startsWith('v=DMARC1'))
    return { key: 'dmarc', label: 'DMARC', ok: !!dmarc, expected: 'v=DMARC1; …', actual: dmarc ?? '(空)' }
  })

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
