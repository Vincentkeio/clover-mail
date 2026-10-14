import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { dnsRecords, domains } from '@/db/schema'
import { batchDns, findZoneId, listDnsRecords } from './cloudflare'
import { resolveDkimPublicKey } from './dkim'
import { diffAgainstExisting, generateDnsRecords } from './dns-generator'
import { runChecklist } from './dns-check'
import { getCfToken, getMailHostname, getPanelSettings, getVpsIp } from './settings'

/**
 * 域级 DNS 编排（供「单域推送」与「CF 账号批量导入/推送」共用）。
 * 与面板单域推送路由同源逻辑：生成 → diff → batch → 回写状态。
 */

export type DomainRow = {
  id: number
  name: string
  mailHostname: string | null
  ownershipToken: string | null
}

export type PushOutcome = {
  domain: string
  ok: boolean
  zoneId?: string
  posted?: number
  patched?: number
  deleted?: number
  changes?: { added: string[]; updated: string[]; deleted: string[] }
  check?: { passed: number; total: number; attempts?: number }
  noop?: boolean
  error?: string
}

/**
 * 推送后通过公网 DNS 检查，并对尚未传播的记录做有限重试。
 * Cloudflare 写入成功不代表递归解析器已经刷新缓存；重推同一批记录也不会加速传播。
 */
async function checkDomainDns(domain: DomainRow): Promise<{ passed: number; total: number; attempts: number } | undefined> {
  const [vpsIp, dkimPublicKey] = await Promise.all([
    getVpsIp(),
    resolveDkimPublicKey(domain.id, domain.name),
  ])
  if (!vpsIp) {
    const items = [{ key: 'vps-ip', label: 'VPS IP', ok: false, expected: '设置服务器公网 IPv4', actual: '尚未设置' }]
    await db.update(domains)
      .set({ dnsStatus: JSON.stringify({ items, checkedAt: new Date().toISOString() }) })
      .where(eq(domains.id, domain.id))
    return { passed: 0, total: items.length, attempts: 1 }
  }

  let items: Awaited<ReturnType<typeof runChecklist>> = []
  let attempts = 0
  const retryDelays = [3000, 7000, 15000, 30000]
  do {
    attempts += 1
    items = await runChecklist({
      domain: domain.name,
      mailHostname: getMailHostname(domain.mailHostname ?? `mail.${domain.name}`),
      ownershipToken: domain.ownershipToken ?? '',
      vpsIp,
      dkimPublicKey,
    })
    if (items.every((item) => item.ok) || items.some((item) => item.key === 'network') || attempts > retryDelays.length) break
    await new Promise((resolve) => setTimeout(resolve, retryDelays[attempts - 1]))
  } while (true)
  await db.update(domains)
    .set({ dnsStatus: JSON.stringify({ items, checkedAt: new Date().toISOString() }) })
    .where(eq(domains.id, domain.id))
  return { passed: items.filter((item) => item.ok).length, total: items.length, attempts }
}

/** 生成记录规格（与 dns 路由一致） */
async function buildSpecs(domain: DomainRow) {
  const [vpsIp, panel, dkimPublicKey] = await Promise.all([
    getVpsIp(),
    getPanelSettings(),
    resolveDkimPublicKey(domain.id, domain.name),
  ])
  return generateDnsRecords({
    domain: domain.name,
    mailHostname: getMailHostname(domain.mailHostname ?? `mail.${domain.name}`),
    ownershipToken: domain.ownershipToken ?? '',
    vpsIp: vpsIp || '203.0.113.10',
    dkimPublicKey,
    dmarcPolicy: panel.dmarcPolicy,
    spfStrict: panel.spfStrict,
    advanced: panel.advancedDns,
  })
}

/** 生成 / 刷新域名下的本地 DNS 记录行 */
export async function ensureDomainRecords(domain: DomainRow): Promise<number> {
  const specs = await buildSpecs(domain)
  await db.delete(dnsRecords).where(eq(dnsRecords.domainId, domain.id))
  if (specs.length > 0) {
    await db.insert(dnsRecords).values(
      specs.map((s) => ({
        domainId: domain.id,
        type: s.type,
        name: s.name,
        content: s.content,
        priority: s.priority ?? null,
        ttl: s.ttl,
        comment: s.cloverTag,
        status: 'planned',
      })),
    )
  }
  return specs.length
}

/** 单域推送：定位 zone → 读现状 → diff → batch → 回写（幂等） */
export async function pushDomainDns(domain: DomainRow, tokenOverride?: string): Promise<PushOutcome> {
  const token = tokenOverride ?? (await getCfToken())
  if (!token) return { domain: domain.name, ok: false, error: '未配置 CF Token' }

  const specs = await buildSpecs(domain)

  let zoneId: string
  try {
    const found = await findZoneId(token, domain.name)
    if (!found) return { domain: domain.name, ok: false, error: `CF 账号下找不到 zone: ${domain.name}` }
    zoneId = found
  } catch (err) {
    return { domain: domain.name, ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  let existing
  try {
    existing = await listDnsRecords(token, zoneId)
  } catch (err) {
    return { domain: domain.name, ok: false, zoneId, error: `拉取 CF 记录失败: ${err instanceof Error ? err.message : err}` }
  }

  const diff = diffAgainstExisting(domain.name, specs, existing)
  const existingById = new Map(existing.map((record) => [record.id, record]))
  const changes = {
    added: diff.posts.map((record) => `${record.type} ${record.name}`),
    updated: diff.patches.map((patch) => {
      const before = existingById.get(patch.id)
      const fields = [
        before?.content !== patch.content ? '内容' : null,
        (before?.priority ?? undefined) !== patch.priority ? '优先级' : null,
        (before?.ttl ?? undefined) !== patch.ttl ? 'TTL' : null,
      ].filter(Boolean)
      return `${before?.type ?? 'DNS'} ${before?.name ?? patch.id}${fields.length ? `（${fields.join('、')}）` : ''}`
    }),
    deleted: diff.deletes.map(({ id }) => {
      const record = existingById.get(id)
      return `${record?.type ?? 'DNS'} ${record?.name ?? id}`
    }),
  }
  if (diff.posts.length === 0 && diff.patches.length === 0 && diff.deletes.length === 0) {
    let check: PushOutcome['check']
    try { check = await checkDomainDns(domain) } catch { /* DNS 探测失败不撤销已成功的同步 */ }
    return { domain: domain.name, ok: true, zoneId, noop: true, posted: 0, patched: 0, deleted: 0, changes, check }
  }

  try {
    await batchDns(token, zoneId, diff)
  } catch (err) {
    return { domain: domain.name, ok: false, zoneId, error: `batch 推送失败: ${err instanceof Error ? err.message : err}` }
  }

  // 状态回写（失败不影响推送结果）
  try {
    const fresh = await listDnsRecords(token, zoneId)
    const idByKey = new Map(fresh.map((r) => [`${r.type}|${r.name}|${r.comment ?? ''}`, r.id]))
    await db.delete(dnsRecords).where(eq(dnsRecords.domainId, domain.id))
    if (specs.length > 0) {
      await db.insert(dnsRecords).values(
        specs.map((s) => {
          const abs = s.name === '@' ? domain.name : `${s.name}.${domain.name}`
          const cfId = idByKey.get(`${s.type}|${abs}|${s.cloverTag}`) ?? null
          return {
            domainId: domain.id,
            type: s.type,
            name: s.name,
            content: s.content,
            priority: s.priority ?? null,
            ttl: s.ttl,
            comment: s.cloverTag,
            status: cfId ? 'pushed' : 'planned',
            cfRecordId: cfId,
            pushedAt: cfId ? new Date().toISOString() : null,
          }
        }),
      )
    }
  } catch {
    /* 忽略 */
  }

  let check: PushOutcome['check']
  try { check = await checkDomainDns(domain) } catch { /* DNS 探测失败不撤销已成功的同步 */ }
  return {
    domain: domain.name,
    ok: true,
    zoneId,
    posted: diff.posts.length,
    patched: diff.patches.length,
    deleted: diff.deletes.length,
    changes,
    check,
  }
}

/** 在面板里建立域名（幂等：已存在则返回原行），供 CF 批量导入使用 */
export async function ensureDomain(
  name: string,
  opts?: { quotaPolicyMb?: number | null },
): Promise<{ created: boolean; row: DomainRow }> {
  const clean = name.trim().toLowerCase()
  const [existing] = await db.select().from(domains).where(eq(domains.name, clean)).limit(1)
  if (existing) {
    return { created: false, row: { id: existing.id, name: existing.name, mailHostname: existing.mailHostname, ownershipToken: existing.ownershipToken } }
  }

  const [row] = await db
    .insert(domains)
    .values({
      name: clean,
      ownershipToken: `clover-verification=${randomBytes(8).toString('hex')}`,
      mailHostname: `mail.${clean}`,
      quotaPolicyMb: opts?.quotaPolicyMb ?? null,
      active: true,
    })
    .returning()
  return { created: true, row: { id: row.id, name: row.name, mailHostname: row.mailHostname, ownershipToken: row.ownershipToken } }
}

/** 面板内全部域 */
export async function allDomains(): Promise<DomainRow[]> {
  const rows = await db
    .select({ id: domains.id, name: domains.name, mailHostname: domains.mailHostname, ownershipToken: domains.ownershipToken })
    .from(domains)
  return rows
}
