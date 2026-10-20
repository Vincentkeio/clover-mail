import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getGlobalMailSettings, getPanelSettings, setSetting, getCfToken } from '@/lib/settings'
import { verifyToken } from '@/lib/cloudflare'
import { syncMailboxPolicies } from '@/lib/mailbox-policy-sync'
import { getTranslator } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  return NextResponse.json(await getPanelSettings(t))
}

export async function PATCH(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()

  const body = await req.json().catch(() => null)
  const patch: {
    vpsIp?: string
    dnsMode?: 'cloudflare' | 'manual'
    cfApiToken?: string
    dmarcPolicy?: string
    spfStrict?: boolean
    advancedDns?: boolean
    allowImap?: boolean
    allowPop3?: boolean
    allowSieve?: boolean
    allowSmtp?: boolean
    allowExternalImages?: boolean
    maxAttachmentMb?: number
  } = body ?? {}

  const mailBooleans = ['allowImap', 'allowPop3', 'allowSieve', 'allowSmtp', 'allowExternalImages'] as const
  if (mailBooleans.some((key) => patch[key] !== undefined && typeof patch[key] !== 'boolean')) {
    return NextResponse.json({ error: t('apiSystem.settings.mailBooleansBoolean') }, { status: 400 })
  }
  if (patch.maxAttachmentMb !== undefined
    && (!Number.isInteger(patch.maxAttachmentMb) || patch.maxAttachmentMb < 0 || patch.maxAttachmentMb > 102400)) {
    return NextResponse.json({ error: t('apiSystem.settings.attachmentSizeInvalid', { max: 102400 }) }, { status: 400 })
  }

  if (patch.vpsIp !== undefined) {
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(patch.vpsIp)) {
      return NextResponse.json({ error: t('apiSystem.settings.vpsIpInvalid') }, { status: 400 })
    }
    await setSetting('vps_ip', patch.vpsIp)
  }
  if (patch.dnsMode !== undefined) {
    if (!['cloudflare', 'manual'].includes(patch.dnsMode)) return NextResponse.json({ error: t('apiSystem.settings.dnsModeInvalid') }, { status: 400 })
    await setSetting('dns_mode', patch.dnsMode)
  }
  if (patch.dmarcPolicy !== undefined) {
    if (!['none', 'quarantine', 'reject'].includes(patch.dmarcPolicy)) {
      return NextResponse.json({ error: t('apiSystem.settings.dmarcPolicyInvalid') }, { status: 400 })
    }
    await setSetting('dmarc_policy', patch.dmarcPolicy)
  }
  if (patch.spfStrict !== undefined) await setSetting('spf_strict', String(patch.spfStrict))
  if (patch.advancedDns !== undefined) await setSetting('advanced_dns', String(patch.advancedDns))

  const globalMailKeys = {
    allowImap: 'protocol_imap',
    allowPop3: 'protocol_pop3',
    allowSieve: 'protocol_sieve',
    allowSmtp: 'protocol_smtp',
    allowExternalImages: 'allow_external_images',
    maxAttachmentMb: 'max_attachment_mb',
  } as const
  for (const [field, key] of Object.entries(globalMailKeys) as Array<[keyof typeof globalMailKeys, string]>) {
    const value = patch[field]
    if (value !== undefined) await setSetting(key, String(value))
  }

  if (patch.cfApiToken !== undefined) {
    if (!patch.cfApiToken.trim()) {
      return NextResponse.json({ error: t('apiSystem.settings.cfTokenEmpty') }, { status: 400 })
    }
    // 加密存储
    const { encryptSecret } = await import('@/lib/crypto')
    await setSetting('cf_api_token', encryptSecret(patch.cfApiToken.trim()), true)
  }
  const mailPolicyChanged = ['allowImap', 'allowPop3', 'allowSieve', 'allowSmtp', 'maxAttachmentMb', 'allowExternalImages'].some((key) => key in patch)
  const policySync = mailPolicyChanged ? await syncMailboxPolicies() : { ok: true as const }
  await audit(admin.username, 'settings.update', undefined, {
    vpsIp: patch.vpsIp !== undefined,
    dnsMode: patch.dnsMode,
    cfApiToken: patch.cfApiToken !== undefined,
    dmarcPolicy: patch.dmarcPolicy,
    spfStrict: patch.spfStrict,
    advancedDns: patch.advancedDns,
    allowImap: patch.allowImap,
    allowPop3: patch.allowPop3,
    allowSieve: patch.allowSieve,
    allowSmtp: patch.allowSmtp,
    allowExternalImages: patch.allowExternalImages,
    maxAttachmentMb: patch.maxAttachmentMb,
    policySynced: policySync.ok,
  })
  if (!policySync.ok) return NextResponse.json({ error: t('apiSystem.settings.policySyncFailed', { error: policySync.error }), mail: await getGlobalMailSettings() }, { status: 502 })
  return NextResponse.json(await getPanelSettings(t))
}

export async function DELETE() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  await setSetting('cf_api_token', '', true)
  await audit(admin.username, 'settings.cf_token_cleared')
  return NextResponse.json(await getPanelSettings(t))
}

/** 供设置页「测试连接」按钮：token 能否看到 zone（传域名） */
export async function POST(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  const body = await req.json().catch(() => ({}))
  const domain = String(body?.domain ?? '')
  const token = await getCfToken()
  if (!token) return NextResponse.json({ ok: false, error: t('apiSystem.settings.cfTokenMissing') }, { status: 400 })
  if (!domain) return NextResponse.json({ ok: false, error: t('apiSystem.settings.domainMissing') }, { status: 400 })
  const result = await verifyToken(token, domain, t)
  await audit(admin.username, 'settings.cf_verify', domain, result)
  return NextResponse.json(result)
}
