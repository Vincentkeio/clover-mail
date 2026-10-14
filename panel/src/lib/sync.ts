import type { DmsResult } from './dms'
import { aliases as aliasCli, domains as domainCli, emails as emailCli, quota as quotaCli } from './dms'

export type SyncResult = { ok: boolean; results: DmsResult[] }

/** 取出第一个失败的 DMS 调用的错误信息 */
export function syncError(s: SyncResult): string {
  for (const r of s.results) {
    if (!r.ok) return r.error
  }
  return 'unknown'
}

function wrap(results: DmsResult[]): SyncResult {
  return { ok: results.every((r) => r.ok), results }
}

/**
 * DB（唯一事实源）→ DMS 的落地编排。
 * 同步失败不阻断 DB 写入（返回 ok=false），由每日对账兜底修复。
 */

export function syncDomainCreate(name: string): Promise<SyncResult> {
  return domainCli.add(name).then((r) => wrap([r]))
}

export function syncDomainDelete(name: string): Promise<SyncResult> {
  return domainCli.del(name).then((r) => wrap([r]))
}

export function syncMailboxCreate(login: string, password: string, quotaMb?: number | null): Promise<SyncResult> {
  return emailCli.add(login, password).then(async (r) => {
    if (!r.ok || !quotaMb) return wrap([r])
    const q = await quotaCli.set(login, `${quotaMb}M`)
    return wrap([r, q])
  })
}

export function syncMailboxDelete(login: string): Promise<SyncResult> {
  return emailCli.del(login).then((r) => wrap([r]))
}

export function syncMailboxPassword(login: string, password: string): Promise<SyncResult> {
  return emailCli.update(login, password).then((r) => wrap([r]))
}

export function syncMailboxQuota(login: string, quotaMb: number): Promise<SyncResult> {
  return quotaCli.set(login, `${quotaMb}M`).then((r) => wrap([r]))
}

export function syncAliasAdd(alias: string, destinations: string[]): Promise<SyncResult> {
  return aliasCli.add(alias, destinations).then((r) => wrap([r]))
}

export function syncAliasDelete(alias: string, destination: string): Promise<SyncResult> {
  return aliasCli.del(alias, destination).then((r) => wrap([r]))
}

/**
 * 规则 → DMS alias 映射：
 * - exact/nonuser：alias = matchValue（完整地址），DMS 原生支持
 * - catchall：alias = `@<domain>`，DMS 原生支持
 * - prefix：DMS CLI 无原生前缀规则 → 仅存面板（dmsSupported=false），M3 用正则/sieve 兜底
 */
export function ruleAliasAddress(matchType: string, matchValue: string | null, domainName: string): string | null {
  switch (matchType) {
    case 'exact':
    case 'nonuser':
      return matchValue
    case 'catchall':
      return `@${domainName}`
    default:
      return null
  }
}
