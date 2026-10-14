import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, routingRules } from '@/db/schema'
import { config } from './config'

const execFileAsync = promisify(execFile)

/**
 * prefix 规则 → Postfix 正则别名表。
 * DMS 的 setup CLI 只支持字面量别名，prefix 语义需要 pcre map；
 * clover 独占一个文件（不碰 DMS 自管文件），user-patches 模板负责把本文件
 * 追加进 virtual_alias_maps。
 */
export const PREFIX_MAP_PATH = '/tmp/docker-mailserver/postfix-virtual-regex.cf'

function escapePcre(literal: string): string {
  return literal.replace(/[\\^$.*+?()[\]{}|]/g, (m) => `\\${m}`)
}

function safeParse(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** 生成 pcre map 内容（按 priority 升序，Postfix 首个命中生效） */
export function buildPrefixMapContent(
  rows: Array<{ prefix: string; domain: string; targets: string[]; priority: number }>,
): string {
  const lines = [
    '# 由 clover 面板自动生成（prefix 路由规则）— 请勿手动编辑，改动会被覆盖',
    `# 生成时间 ${new Date().toISOString()}，共 ${rows.length} 条`,
    '',
  ]
  for (const r of [...rows].sort((a, b) => a.priority - b.priority)) {
    // 例：/^sales[^@]*@demo\.clover\.dev$/  boss@gmail.com,hello@gmail.com
    lines.push(`/^${escapePcre(r.prefix)}[^@]*@${escapePcre(r.domain)}$/  ${r.targets.join(',')}`)
  }
  return lines.join('\n') + '\n'
}

/**
 * 汇总库内全部启用中的 prefix 规则并下发（幂等：无 prefix 规则时也会写空表，
 * 保证「删掉最后一条 prefix 规则」同样生效）。DMS 不可达时降级返回 ok:false。
 */
export async function syncPrefixRules(): Promise<{ ok: boolean; count: number; error?: string }> {
  const rows = await db
    .select({
      matchType: routingRules.matchType,
      matchValue: routingRules.matchValue,
      targets: routingRules.targets,
      priority: routingRules.priority,
      active: routingRules.active,
      domainName: domains.name,
    })
    .from(routingRules)
    .innerJoin(domains, eq(routingRules.domainId, domains.id))
    .where(eq(routingRules.active, true))

  const payload = rows
    .filter((r) => r.matchType === 'prefix' && r.matchValue)
    .map((r) => ({
      prefix: r.matchValue as string,
      domain: r.domainName,
      targets: safeParse(r.targets),
      priority: r.priority,
    }))

  const content = buildPrefixMapContent(payload)

  try {
    const dir = mkdtempSync(join(tmpdir(), 'clover-prefix-'))
    const local = join(dir, 'postfix-virtual-regex.cf')
    writeFileSync(local, content, 'utf8')

    await execFileAsync('docker', ['cp', local, `${config.dmsContainer}:${PREFIX_MAP_PATH}`], { timeout: 15_000 })
    // pcre 表无需 postmap；reload 让 postfix 重新读取
    await execFileAsync('docker', ['exec', config.dmsContainer, 'postfix', 'reload'], { timeout: 20_000 })
    return { ok: true, count: payload.length }
  } catch (err) {
    return { ok: false, count: payload.length, error: err instanceof Error ? err.message : String(err) }
  }
}
