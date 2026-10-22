import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes, routingRules } from '@/db/schema'
import { config } from './config'
import { createTranslator, type Translator } from './i18n/translate'
import { createRuleSchema, emailSchema } from './validators'

const execFileAsync = promisify(execFile)

/** 调用方未传 Translator 时的兜底（默认语言）。 */
const fallbackTranslator = createTranslator('en')

/** Clover 的组合路由表优先于 DMS 原生 alias 表，令同一地址命中的规则一次合并投递。 */
export const PREFIX_MAP_PATH = '/tmp/docker-mailserver/postfix-virtual-regex.cf'
const PREFIX_MAIN_START = '# BEGIN CLOVER PREFIX ROUTING'
const PREFIX_MAIN_END = '# END CLOVER PREFIX ROUTING'

export type RoutingMapRule = { matchType: string; matchValue: string | null; domain: string; targets: string[]; priority: number }

function escapePcre(literal: string): string {
  return literal.replace(/[\\/^$.*+?()[\]{}|]/g, (m) => `\\${m}`)
}

function uniqueTargets(rules: RoutingMapRule[]): string[] {
  const seen = new Set<string>()
  const targets: string[] = []
  for (const rule of [...rules].sort((a, b) => a.priority - b.priority)) {
    for (const target of rule.targets) {
      const key = target.trim().toLowerCase()
      if (key && !seen.has(key)) { seen.add(key); targets.push(target.trim()) }
    }
  }
  return targets
}

/** 纯函数：方便本地验证组合逻辑，不依赖数据库或邮件服务。 */
export function buildPrefixMapContent(rows: RoutingMapRule[], activeMailboxes: string[] = []): string {
  const activeRules = rows.filter((row) => ['exact', 'nonuser', 'prefix', 'catchall'].includes(row.matchType))
  const exactRules = activeRules.filter((row) => (row.matchType === 'exact' || row.matchType === 'nonuser') && row.matchValue)
  const prefixes = activeRules.filter((row) => row.matchType === 'prefix' && row.matchValue)
  const catchalls = activeRules.filter((row) => row.matchType === 'catchall')
  const exactAddresses = new Set(exactRules.map((row) => row.matchValue!.toLowerCase()))
  const lines = [
    '# 由 clover 面板自动生成（组合路由规则）— 请勿手动编辑，改动会被覆盖',
    `# 生成时间 ${new Date().toISOString()}`,
    '',
  ]

  // 真实邮箱应直达自己的收件箱，避免把 alias 的本地目标再次展开成 catch-all。
  const mailboxAddresses = [...new Set(activeMailboxes.map((address) => address.trim().toLowerCase()).filter(Boolean))]
  for (const address of mailboxAddresses.filter((address) => !exactAddresses.has(address)).sort()) {
    lines.push(`/^${escapePcre(address)}$/  ${address}`)
  }

  function matchesFor(address: string, domain: string): RoutingMapRule[] {
    const local = address.slice(0, address.lastIndexOf('@'))
    return activeRules.filter((rule) => {
      if (rule.domain.toLowerCase() !== domain.toLowerCase()) return false
      if ((rule.matchType === 'exact' || rule.matchType === 'nonuser') && rule.matchValue?.toLowerCase() === address) return true
      if (rule.matchType === 'prefix' && rule.matchValue && local.startsWith(rule.matchValue.toLowerCase())) return true
      return rule.matchType === 'catchall'
    })
  }

  const explicitAddresses = [...new Set(exactRules.map((row) => row.matchValue!.toLowerCase()))].sort()
  for (const address of explicitAddresses) {
    const domain = address.slice(address.lastIndexOf('@') + 1)
    const targets = uniqueTargets(matchesFor(address, domain))
    if (targets.length) lines.push(`/^${escapePcre(address)}$/  ${targets.join(',')}`)
  }

  const prefixCandidates = [...new Map(prefixes.map((rule) => [`${rule.domain.toLowerCase()}\n${rule.matchValue!.toLowerCase()}`, rule])).values()]
    .sort((a, b) => b.matchValue!.length - a.matchValue!.length || a.priority - b.priority)
  for (const candidate of prefixCandidates) {
    const prefix = candidate.matchValue!.toLowerCase()
    const targets = uniqueTargets([
      ...prefixes.filter((rule) => rule.domain.toLowerCase() === candidate.domain.toLowerCase() && prefix.startsWith(rule.matchValue!.toLowerCase())),
      ...catchalls.filter((rule) => rule.domain.toLowerCase() === candidate.domain.toLowerCase()),
    ])
    if (targets.length) lines.push(`/^${escapePcre(prefix)}[^@]*@${escapePcre(candidate.domain)}$/  ${targets.join(',')}`)
  }

  const catchallDomains = [...new Set(catchalls.map((rule) => rule.domain.toLowerCase()))].sort()
  for (const domain of catchallDomains) {
    const targets = uniqueTargets(catchalls.filter((item) => item.domain.toLowerCase() === domain))
    if (targets.length) lines.push(`/^[^@]+@${escapePcre(domain)}$/  ${targets.join(',')}`)
  }
  return lines.join('\n') + '\n'
}

/** 汇总启用中的 alias、prefix 和 catch-all 规则；首个匹配项合并所有重叠目标。 */
export async function syncPrefixRules(t: Translator = fallbackTranslator): Promise<{ ok: boolean; count: number; error?: string }> {
  const [rows, mailboxRows] = await Promise.all([
    db.select({ matchType: routingRules.matchType, matchValue: routingRules.matchValue, targets: routingRules.targets,
      priority: routingRules.priority, domainName: domains.name })
      .from(routingRules).innerJoin(domains, and(eq(routingRules.domainId, domains.id), eq(domains.active, true)))
      .where(eq(routingRules.active, true)),
    db.select({ login: mailboxes.login }).from(mailboxes)
      .innerJoin(domains, and(eq(mailboxes.domainId, domains.id), eq(domains.active, true)))
      .where(eq(mailboxes.active, true)),
  ])
  const rules: RoutingMapRule[] = rows.map((row) => {
    let targets: string[] = []
    try { const parsed: unknown = JSON.parse(row.targets); if (Array.isArray(parsed)) targets = parsed.filter((target): target is string => typeof target === 'string') } catch { /* Ignore malformed stale rows. */ }
    return { matchType: row.matchType, matchValue: row.matchValue, domain: row.domainName, targets, priority: row.priority }
  })
  const content = buildPrefixMapContent(rules, mailboxRows.map((row) => row.login))
  let dir: string | undefined
  try {
    // Refuse malformed legacy/imported rows before touching the active map.
    for (const rule of rules) createRuleSchema.parse({ ...rule, matchValue: rule.matchValue ?? undefined })
    for (const box of mailboxRows) emailSchema.parse(box.login)
    dir = mkdtempSync(join(tmpdir(), 'clover-routing-'))
    const local = join(dir, 'postfix-virtual-regex.cf')
    const localMain = join(dir, 'postfix-main.cf')
    writeFileSync(local, content, 'utf8')
    await execFileAsync('docker', ['cp', local, `${config.dmsContainer}:${PREFIX_MAP_PATH}`], { timeout: 15_000 })
    const { stdout: mapTypes } = await execFileAsync('docker', ['exec', config.dmsContainer, 'postconf', '-m'], { timeout: 15_000 })
    if (!mapTypes.split(/\r?\n/).includes('pcre')) throw new Error(t('apiErrors.prefixSync.pcreMissing'))

    const { stdout: currentMapsOutput } = await execFileAsync('docker', ['exec', config.dmsContainer, 'postconf', '-h', 'virtual_alias_maps'], { timeout: 15_000 })
    const maps = currentMapsOutput.trim().split(',').map((value) => value.trim()).filter(Boolean)
    const prefixMap = `pcre:${PREFIX_MAP_PATH}`
    const nextMaps = [prefixMap, ...maps.filter((map) => map !== prefixMap)]
    const { stdout: previousMain } = await execFileAsync('docker', ['exec', config.dmsContainer, 'sh', '-ec', 'cat /tmp/docker-mailserver/postfix-main.cf 2>/dev/null || true'], { timeout: 15_000 })
    const baseMain = previousMain.replace(new RegExp(`(?:^|\\n)${PREFIX_MAIN_START}[^\\n]*[\\s\\S]*?${PREFIX_MAIN_END}[^\\n]*(?:\\n|$)`, 'g'), '').trim()
    const nextMain = [baseMain, PREFIX_MAIN_START, `virtual_alias_maps = ${nextMaps.join(', ')}`, PREFIX_MAIN_END, ''].filter(Boolean).join('\n')
    writeFileSync(localMain, nextMain, 'utf8')
    await execFileAsync('docker', ['cp', localMain, `${config.dmsContainer}:/tmp/docker-mailserver/postfix-main.cf`], { timeout: 15_000 })
    await execFileAsync('docker', ['exec', config.dmsContainer, 'postconf', '-e', `virtual_alias_maps=${nextMaps.join(', ')}`], { timeout: 15_000 })
    await execFileAsync('docker', ['exec', config.dmsContainer, 'postfix', 'reload'], { timeout: 20_000 })
    const { stdout: appliedMaps } = await execFileAsync('docker', ['exec', config.dmsContainer, 'postconf', '-h', 'virtual_alias_maps'], { timeout: 15_000 })
    if (!appliedMaps.includes(prefixMap)) throw new Error(t('apiErrors.prefixSync.mapNotApplied'))
    return { ok: true, count: rules.length }
  } catch (err) {
    return { ok: false, count: rules.length, error: err instanceof Error ? err.message : String(err) }
  } finally { if (dir) rmSync(dir, { recursive: true, force: true }) }
}
