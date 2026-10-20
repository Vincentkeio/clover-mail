/**
 * Cloudflare API v4 客户端（M2）。
 * 认证：Authorization: Bearer <token>，最小权限模板 Zone → DNS → Edit。
 * 关键行为（已核对官方文档）：
 * - batch 端点执行顺序固定 deletes → patches → puts → posts（非数组顺序）
 * - 4XX 时 errors[].source.pointer 定位出错项（如 /body/posts/0）
 * - MX/SRV content 指向域名必须 FQDN 尾点；DKIM 长 TXT 单条 content 免分片
 * - proxied 仅对可代理记录生效，邮件相关记录一律 false
 */

import { DEFAULT_LOCALE } from '@/lib/i18n/config'
import { createTranslator, type Translator } from '@/lib/i18n/translate'
import { redactSensitiveText } from './redact'

const API_BASE = 'https://api.cloudflare.com/client/v4'
const PER_PAGE = 100 // 保守分批，M2 真机验证上限

/** 调用方没传界面语言时用的兜底（英文）。 */
const fallbackTranslator = createTranslator(DEFAULT_LOCALE)

export type CfRecordInput = {
  type: string
  name: string
  content: string
  ttl?: number
  priority?: number
  proxied?: boolean
  comment?: string
}

export type CfRecord = CfRecordInput & { id: string }

type CfEnvelope<T> = {
  success: boolean
  errors: Array<{ code: number; message: string }>
  result: T
  result_info?: { page: number; per_page: number; total_pages: number; count: number }
}

async function cf<T>(token: string, path: string, init?: RequestInit, t: Translator = fallbackTranslator): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const data = (await res.json().catch(() => null)) as CfEnvelope<T> | null
  if (!res.ok || !data?.success) {
    const msg = data?.errors?.map((e) => `${e.code} ${e.message}`).join('; ') ?? `HTTP ${res.status}`
    throw new Error(t('apiErrors.cloudflare.apiFailed', { message: redactSensitiveText(msg, [token]) }))
  }
  return data.result
}

/** 按域名精确查 zone_id（域名须已在 CF 账号下） */
export async function findZoneId(token: string, domain: string, t: Translator = fallbackTranslator): Promise<string | null> {
  const zones = await cf<Array<{ id: string; name: string }>>(
    token,
    `/zones?name=${encodeURIComponent(domain)}&per_page=50`,
    undefined,
    t,
  )
  return zones.find((z) => z.name === domain)?.id ?? null
}

export type CfZone = { id: string; name: string; status: string; type?: string; account?: { name: string } }

/**
 * 拉取 token 可见的**全部 zone**（分页）。
 * 支撑「填一次 Token → 面板列出你 CF 名下所有域名 → 一键导入并配好 DNS」。
 */
export async function listAllZones(token: string, t: Translator = fallbackTranslator): Promise<CfZone[]> {
  const out: CfZone[] = []
  let page = 1
  for (;;) {
    const zones = await cf<CfZone[]>(token, `/zones?per_page=50&page=${page}&order=name&direction=asc`, undefined, t)
    out.push(...zones)
    if (zones.length < 50) break
    page += 1
    if (page > 40) break // 上限 2000 个域，防跑飞
  }
  return out
}

/** 分页拉全量记录（幂等 diff 用） */
export async function listDnsRecords(
  token: string,
  zoneId: string,
  filter?: { type?: string; name?: string },
  t: Translator = fallbackTranslator,
): Promise<CfRecord[]> {
  const out: CfRecord[] = []
  let page = 1
  for (;;) {
    const params = new URLSearchParams({ per_page: String(PER_PAGE), page: String(page) })
    if (filter?.type) params.set('type', filter.type)
    if (filter?.name) params.set('name', filter.name)
    const records = await cf<CfRecord[]>(token, `/zones/${zoneId}/dns_records?${params}`, undefined, t)
    out.push(...records)
    if (records.length < PER_PAGE) break
    page += 1
  }
  return out
}

export type BatchOps = {
  deletes?: Array<{ id: string }>
  patches?: Array<{ id: string } & Partial<CfRecordInput>>
  puts?: CfRecordInput[]
  posts?: CfRecordInput[]
}

/** 批量写入。CF 内部按 deletes→patches→puts→posts 固定顺序执行，单请求单事务 */
export async function batchDns(
  token: string,
  zoneId: string,
  ops: BatchOps,
  t: Translator = fallbackTranslator,
): Promise<{ deletes: unknown[]; patches: unknown[]; puts: unknown[]; posts: unknown[] }> {
  return cf(token, `/zones/${zoneId}/dns_records/batch`, {
    method: 'POST',
    body: JSON.stringify({
      deletes: ops.deletes ?? [],
      patches: ops.patches ?? [],
      puts: ops.puts ?? [],
      posts: ops.posts ?? [],
    }),
  }, t)
}

/** 连通性自检：token 能否看到目标 zone */
export async function verifyToken(token: string, domain: string, t: Translator = fallbackTranslator): Promise<{ ok: boolean; zoneId?: string; error?: string }> {
  try {
    const zoneId = await findZoneId(token, domain, t)
    return zoneId ? { ok: true, zoneId } : { ok: false, error: t('apiErrors.cloudflare.zoneMissing', { domain }) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
