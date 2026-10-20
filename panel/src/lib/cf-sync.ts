import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { dnsRecords, domains } from '@/db/schema'
import { batchDns, findZoneId, listDnsRecords } from './cloudflare'
import { resolveDkimPublicKey } from './dkim'
import { diffAgainstExisting, generateDnsRecords } from './dns-generator'
import { runChecklist } from './dns-check'
import { createTranslator, type Translator } from './i18n/translate'
import { getCfToken, getMailHostname, getPanelSettings, getVpsIp } from './settings'

/** 调用方未传 Translator 时的兜底（默认语言）。 */
const fallbackTranslator = createTranslator('en')

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
async function checkDomainDns(domain: DomainRow, t: Translator = fallbackTranslator): Promise<{ passed: number; total: number; attempts: number } | undefined> {
  const [vpsIp, dkimPublicKey] = await Promise.all([
    getVpsIp(),
    resolveDkimPublicKey(domain.id, domain.name, t),
  ])
  if (!vpsIp) {
    const items = [{ key: 'vps-ip', label: 'VPS IP', ok: false, expected: t('apiErrors.cfSync.vpsIpExpected'), actual: t('apiErrors.cfSync.vpsIpActual') }]
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
    }, t)
    if (items.every((item) => item.ok) || items.some((item) => item.key === 'network') || attempts > retryDelays.length) break
    await new Promise((resolve) => setTimeout(resolve, retryDelays[attempts - 1]))
  } while (true)
  await db.update(domains)
    .set({ dnsStatus: JSON.stringify({ items, checkedAt: new Date().toISOString() }) })
    .where(eq(domains.id, domain.id))
  return { passed: items.filter((item) => item.ok).length, total: items.length, attempts }
}

/** 生成记录规格（与 dns 路由一致） */
async function buildSpecs(domain: DomainRow, t: Translator = fallbackTranslator) {
  const [vpsIp, panel, dkimPublicKey] = await Promise.all([
    getVpsIp(),
    getPanelSettings(),
    resolveDkimPublicKey(domain.id, domain.name, t),
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
  }, t)
}

/** 生成 / 刷新域名下的本地 DNS 记录行 */
export async function ensureDomainRecords(domain: DomainRow, t: Translator = fallbackTranslator): Promise<number> {
  const specs = await buildSpecs(domain, t)
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
export async function pushDomainDns(domain: DomainRow, tokenOverride?: string, t: Translator = fallbackTranslator): Promise<PushOutcome> {
  const token = tokenOverride ?? (await getCfToken())
  if (!token) return { domain: domain.name, ok: false, error: t('apiErrors.cfSync.tokenMissing') }

  const specs = await buildSpecs(domain, t)

  let zoneId: string
  try {
    const found = await findZoneId(token, domain.name, t)
    if (!found) return { domain: domain.name, ok: false, error: t('apiErrors.cfSync.zoneNotFound', { domain: domain.name }) }
    zoneId = found
  } catch (err) {
    return { domain: domain.name, ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  let existing
  try {
    existing = await listDnsRecords(token, zoneId, undefined, t)
  } catch (err) {
    return { domain: domain.name, ok: false, zoneId, error: t('apiErrors.cfSync.listRecordsFailed', { error: err instanceof Error ? err.message : String(err) }) }
  }

  const diff = diffAgainstExisting(domain.name, specs, existing, t)
  if (diff.conflicts.length > 0) {
    return {
      domain: domain.name,
      ok: false,
      zoneId,
      error: t('apiErrors.cfSync.conflicts', { conflicts: diff.conflicts.join(' ') }),
    }
  }
  const existingById = new Map(existing.map((record) => [record.id, record]))
  const changes = {
    added: diff.posts.map((record) => `${record.type} ${record.name}`),
    updated: diff.patches.map((patch) => {
      const before = existingById.get(patch.id)
      const target = `${before?.type ?? 'DNS'} ${before?.name ?? patch.id}`
      const fields = [
        before?.content !== patch.content ? t('apiErrors.cfSync.fieldContent') : null,
        (before?.priority ?? undefined) !== patch.priority ? t('apiErrors.cfSync.fieldPriority') : null,
        (before?.ttl ?? undefined) !== patch.ttl ? 'TTL' : null,
        before?.proxied !== patch.proxied ? t('apiErrors.cfSync.fieldProxied') : null,
      ].filter(Boolean)
      return fields.length
        ? t('apiErrors.cfSync.changeFields', { target, fields: fields.join(t('apiErrors.dns.listSeparator')) })
        : target
    }),
    deleted: diff.deletes.map(({ id }) => {
      const record = existingById.get(id)
      return `${record?.type ?? 'DNS'} ${record?.name ?? id}`
    }),
  }
  if (diff.posts.length === 0 && diff.patches.length === 0 && diff.deletes.length === 0) {
    let check: PushOutcome['check']
    try { check = await checkDomainDns(domain, t) } catch { /* DNS 探测失败不撤销已成功的同步 */ }
    return { domain: domain.name, ok: true, zoneId, noop: true, posted: 0, patched: 0, deleted: 0, changes, check }
  }

  try {
    await batchDns(token, zoneId, diff, t)
  } catch (err) {
    return { domain: domain.name, ok: false, zoneId, error: t('apiErrors.cfSync.batchFailed', { error: err instanceof Error ? err.message : String(err) }) }
  }

  // 状态回写（失败不影响推送结果）
  try {
    const fresh = await listDnsRecords(token, zoneId, undefined, t)
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
  try { check = await checkDomainDns(domain, t) } catch { /* DNS 探测失败不撤销已成功的同步 */ }
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
