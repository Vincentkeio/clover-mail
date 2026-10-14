import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { settings } from '@/db/schema'
import { decryptSecret, encryptSecret, maskSecret } from './crypto'

export type DmarcPolicy = 'none' | 'quarantine' | 'reject'

export type GlobalMailSettings = {
  allowImap: boolean
  allowPop3: boolean
  allowSieve: boolean
  allowSmtp: boolean
  allowExternalImages: boolean
  maxAttachmentMb: number
}

export type PanelSettings = {
  vpsIp: string
  dnsMode: 'cloudflare' | 'manual'
  dmarcPolicy: DmarcPolicy
  spfStrict: boolean
  advancedDns: boolean
  cfTokenSet: boolean
  cfTokenMasked: string | null
  mail: GlobalMailSettings
}

const KEY_VPS_IP = 'vps_ip'
const KEY_CF_TOKEN = 'cf_api_token'
const KEY_CF_TOKEN_DISABLED = 'cf_api_token_disabled'
const KEY_DMARC = 'dmarc_policy'
const KEY_SPF = 'spf_strict'
const KEY_ADVANCED = 'advanced_dns'
const GLOBAL_MAIL_SETTINGS = {
  allowImap: 'protocol_imap',
  allowPop3: 'protocol_pop3',
  allowSieve: 'protocol_sieve',
  allowSmtp: 'protocol_smtp',
  allowExternalImages: 'allow_external_images',
  maxAttachmentMb: 'max_attachment_mb',
} as const

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
  return row?.value ?? null
}

export async function setSetting(key: string, value: string, sensitive = false): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, sensitive })
    .onConflictDoUpdate({ target: settings.key, set: { value, sensitive } })
}

export async function getGlobalMailSettings(): Promise<GlobalMailSettings> {
  const rows = await db.select({ key: settings.key, value: settings.value })
    .from(settings).where(inArray(settings.key, Object.values(GLOBAL_MAIL_SETTINGS)))
  const values = new Map(rows.map((row) => [row.key, row.value]))
  const allowImap = values.get(GLOBAL_MAIL_SETTINGS.allowImap)
  const allowPop3 = values.get(GLOBAL_MAIL_SETTINGS.allowPop3)
  const allowSieve = values.get(GLOBAL_MAIL_SETTINGS.allowSieve)
  const allowSmtp = values.get(GLOBAL_MAIL_SETTINGS.allowSmtp)
  const allowExternalImages = values.get(GLOBAL_MAIL_SETTINGS.allowExternalImages)
  const maxRaw = values.get(GLOBAL_MAIL_SETTINGS.maxAttachmentMb)
  const parsedLimit = Number(maxRaw ?? 100)
  return {
    allowImap: allowImap !== 'false',
    allowPop3: allowPop3 !== 'false',
    allowSieve: allowSieve !== 'false',
    allowSmtp: allowSmtp !== 'false',
    allowExternalImages: allowExternalImages === 'true',
    maxAttachmentMb: Number.isInteger(parsedLimit) && parsedLimit >= 0 && parsedLimit <= 102400 ? parsedLimit : 100,
  }
}

/** CF token 解密取出（调用方负责不再外泄）；无库内值时回落到安装器写入的 .env 预置 */
export async function getCfToken(): Promise<string | null> {
  if ((await getSetting(KEY_CF_TOKEN_DISABLED)) === 'true') return null
  const raw = await getSetting(KEY_CF_TOKEN)
  if (raw) {
    try {
      return decryptSecret(raw)
    } catch {
      return null
    }
  }
  const fromEnv = process.env.CLOVER_CF_API_TOKEN || process.env.CF_API_TOKEN
  return fromEnv?.trim() || null
}

export async function getVpsIp(): Promise<string> {
  const stored = await getSetting(KEY_VPS_IP)
  if (stored) return stored
  return process.env.CLOVER_VPS_IP?.trim() || ''
}

/** 所有域名共用邮件服务主机名；未配置时兼容旧数据的域名级默认值。 */
export function getMailHostname(fallback = ''): string {
  return (process.env.MAIL_HOSTNAME || process.env.MAIL_FQDN || fallback).trim().replace(/\.$/, '').toLowerCase()
}

export async function getPanelSettings(): Promise<PanelSettings> {
  const [vpsIp, dnsMode, cfRaw, dmarc, spf, advanced, mail] = await Promise.all([
    getSetting(KEY_VPS_IP),
    getSetting('dns_mode'),
    getSetting(KEY_CF_TOKEN),
    getSetting(KEY_DMARC),
    getSetting(KEY_SPF),
    getSetting(KEY_ADVANCED),
    getGlobalMailSettings(),
  ])
  const effectiveToken = await getCfToken()
  let masked: string | null = effectiveToken ? maskSecret(effectiveToken) : null
  if (cfRaw && !effectiveToken) masked = '***（解密失败，请重新录入）'
  return {
    vpsIp: vpsIp ?? process.env.CLOVER_VPS_IP?.trim() ?? '',
    dnsMode: dnsMode === 'manual' ? 'manual' : 'cloudflare',
    dmarcPolicy: (dmarc as DmarcPolicy) ?? 'quarantine',
    spfStrict: spf !== 'false',
    advancedDns: advanced === 'true',
    cfTokenSet: !!effectiveToken,
    cfTokenMasked: masked,
    mail,
  }
}
