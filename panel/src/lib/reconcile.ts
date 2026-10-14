import { db } from '@/db'
import { domains, mailboxes, routingRules } from '@/db/schema'
import { DMS_CONFIG_DIR, readContainerFile } from './dms'
import { ruleAliasAddress, syncAliasAdd, syncAliasDelete, syncError, syncMailboxDelete } from './sync'
import { syncPrefixRules } from './prefix-sync'

/** postfix-accounts.cf：每行 `login|hashed-password` */
export function parseAccountsFile(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('|')[0])
    .filter(Boolean)
}

/** postfix-virtual.cf：每行 `alias target[,target…]`（空格分隔） */
export function parseVirtualFile(content: string): Array<{ alias: string; targets: string[] }> {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [alias, ...rest] = line.split(/\s+/)
      return {
        alias,
        targets: (rest.join(' ') || '').split(',').map((t) => t.trim()).filter(Boolean),
      }
    })
    .filter((row) => row.alias && row.targets.length > 0)
}

function parseTargets(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export type ReconcileReport = {
  dmsReachable: boolean
  mailboxes: { missing: string[]; extra: string[] }
  rules: {
    missing: Array<{ alias: string; targets: string[] }>
    extra: Array<{ alias: string; targets: string[] }>
  }
  healed: string[]
  errors: string[]
}

/**
 * 每日对账：面板 DB（唯一事实源）vs DMS 实际配置。
 * - heal=false（默认，dry-run）：只出差异报告
 * - heal=true：补齐缺失 alias、清理 DMS 侧多余 alias/账号
 *   （DB 有而 DMS 无的邮箱密码已不可恢复，只报告不自动建，需人工在面板重建）
 */
export async function runReconcile(options: { heal?: boolean } = {}): Promise<ReconcileReport> {
  const heal = options.heal ?? false
  const report: ReconcileReport = {
    dmsReachable: false,
    mailboxes: { missing: [], extra: [] },
    rules: { missing: [], extra: [] },
    healed: [],
    errors: [],
  }

  const [dbDomains, dbMailboxes, dbRules] = await Promise.all([
    db.select().from(domains),
    db.select().from(mailboxes),
    db.select().from(routingRules),
  ])

  const [accountsFile, virtualFile] = await Promise.all([
    readContainerFile(`${DMS_CONFIG_DIR}/postfix-accounts.cf`),
    readContainerFile(`${DMS_CONFIG_DIR}/postfix-virtual.cf`),
  ])
  if (!accountsFile.ok || !virtualFile.ok) {
    const errs = [accountsFile.ok ? null : accountsFile.error, virtualFile.ok ? null : virtualFile.error]
    report.errors.push(...errs.filter((e): e is string => !!e))
    return report
  }
  report.dmsReachable = true

  // ---- 账号 diff ----
  const dmsLogins = parseAccountsFile(accountsFile.stdout)
  const dbLogins = dbMailboxes.filter((m) => m.active).map((m) => m.login)
  report.mailboxes.missing = dbLogins.filter((l) => !dmsLogins.includes(l))
  report.mailboxes.extra = dmsLogins.filter((l) => !dbLogins.includes(l))

  // ---- 规则 → alias diff（exact/nonuser/catchall 落地；prefix 暂不落地）----
  const expected = new Map<string, string[]>()
  for (const rule of dbRules) {
    if (!rule.active) continue
    const domain = dbDomains.find((d) => d.id === rule.domainId)
    if (!domain) continue
    const addr = ruleAliasAddress(rule.matchType, rule.matchValue, domain.name)
    if (!addr) continue
    const targets = parseTargets(rule.targets)
    expected.set(addr, [...new Set([...(expected.get(addr) ?? []), ...targets])])
  }
  const dmsAliasMap = new Map(parseVirtualFile(virtualFile.stdout).map((a) => [a.alias, a.targets]))
  report.rules.missing = [...expected.entries()]
    .filter(([addr]) => !dmsAliasMap.has(addr))
    .map(([alias, targets]) => ({ alias, targets }))
  report.rules.extra = [...dmsAliasMap.entries()]
    .filter(([addr]) => !expected.has(addr))
    .map(([alias, targets]) => ({ alias, targets }))

  // ---- heal ----
  if (heal) {
    // prefix 规则的正则别名表（整体重写，幂等）
    const prefixResult = await syncPrefixRules()
    if (prefixResult.ok) {
      report.healed.push(`prefix-map ${prefixResult.count} 条`)
    } else {
      report.errors.push(`prefix-map 下发失败: ${prefixResult.error ?? 'unknown'}`)
    }
    for (const { alias, targets } of report.rules.missing) {
      const r = await syncAliasAdd(alias, targets)
      if (r.ok) report.healed.push(`alias+ ${alias}`)
      else report.errors.push(`alias+ ${alias} 失败: ${syncError(r)}`)
    }
    for (const { alias, targets } of report.rules.extra) {
      const r = await syncAliasDelete(alias, targets[0] ?? '')
      if (r.ok) report.healed.push(`alias- ${alias}`)
      else report.errors.push(`alias- ${alias} 失败: ${syncError(r)}`)
    }
    for (const login of report.mailboxes.extra) {
      const r = await syncMailboxDelete(login)
      if (r.ok) report.healed.push(`mailbox- ${login}`)
      else report.errors.push(`mailbox- ${login} 失败: ${syncError(r)}`)
    }
    if (report.mailboxes.missing.length > 0) {
      report.errors.push(`以下邮箱 DMS 侧缺失但密码不可恢复，需人工重建: ${report.mailboxes.missing.join(', ')}`)
    }
  }

  return report
}
