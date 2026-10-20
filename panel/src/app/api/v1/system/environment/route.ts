import { NextResponse } from 'next/server'
import { isIPv4 } from 'node:net'
import { lookup, resolveMx } from 'node:dns/promises'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes, routingRules } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { checkTcpPort, readCertificate } from '@/lib/certificate-probe'
import { readCertificateHelperStatus } from '@/lib/certificate-status'
import { resolveA, resolvePtr, runChecklist } from '@/lib/dns-check'
import { resolveDkimPublicKey } from '@/lib/dkim'
import { supervisorStatus } from '@/lib/dms'
import { getMailHostname, getPanelSettings, getSetting, getVpsIp } from '@/lib/settings'
import { audit } from '@/lib/audit'
import { getTranslator } from '@/lib/i18n/server'
import type { Translator } from '@/lib/i18n/translate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Step = { key: string; label: string; ok: boolean; detail: string; href: string; action: string; repair?: boolean }
type StoredCheck = { items?: Array<{ key: string; label: string; ok: boolean }>; checkedAt?: string }

function dnsState(raw: string | null): StoredCheck {
  try { return raw ? JSON.parse(raw) as StoredCheck : {} } catch { return {} }
}

export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const t = await getTranslator()
  const [settings, domainRows, dnsMode, dms, mailboxRows, ruleCounts, helperStatus] = await Promise.all([
    getPanelSettings(), db.select().from(domains).orderBy(asc(domains.id)), getSetting('dns_mode'), supervisorStatus(),
    db.select().from(mailboxes),
    db.select({ domainId: routingRules.domainId, n: sql<number>`count(*)` }).from(routingRules).groupBy(routingRules.domainId),
    readCertificateHelperStatus().catch(() => null),
  ])
  const panelHost = process.env.PANEL_HOSTNAME || process.env.PANEL_FQDN || ''
  const mailHost = getMailHostname()
  const sharedCaddy = process.env.CLOVER_SHARED_CADDY === '1'
  const sharedNginx = process.env.CLOVER_SHARED_NGINX === '1' || (process.env.CLOVER_CADDY_SCHEME === 'http' && !sharedCaddy)
  const [panelTls, mailPorts, smtpEgress] = await Promise.all([
    panelHost ? readCertificate(sharedNginx || sharedCaddy ? 'host.docker.internal' : 'caddy', 443, panelHost) : null,
    mailHost ? Promise.all([25, 465, 587, 993].map((port) => checkTcpPort(process.env.DMS_CONTAINER || 'docker-mailserver', port))) : null,
    checkOutboundSmtp25(t),
  ])
  const mailCertificate = helperStatus?.certificates?.mail
  const mailCertOk = Boolean(mailCertificate?.installed && mailCertificate.daysRemaining !== null && mailCertificate.daysRemaining >= 0)
  const mailPortsOk = Boolean(mailPorts?.every((port) => port.ok))
  const rdns = await checkMailRdns(settings.vpsIp, mailHost, t)
  const activeMailboxCount = mailboxRows.filter((mailbox) => mailbox.active).length
  const active = domainRows.filter((domain) => domain.active)
  const dns = domainRows.map((domain) => ({ domain, state: dnsState(domain.dnsStatus) }))
  const activeDns = dns.filter(({ domain }) => domain.active)
  const unverified = activeDns.filter(({ state }) => !state.items?.length || state.items.some((item) => !item.ok))
  const mailboxCounts = new Map<number, number>()
  for (const mailbox of mailboxRows) mailboxCounts.set(mailbox.domainId, (mailboxCounts.get(mailbox.domainId) ?? 0) + 1)
  const ruleCountMap = new Map(ruleCounts.map((row) => [row.domainId, Number(row.n)]))
  const manual = dnsMode === 'manual'
  const steps: Step[] = [
    { key: 'cloudflare', label: t('apiErrors.environment.stepCloudflare'), ok: manual || settings.cfTokenSet,
      detail: manual ? t('apiErrors.environment.cloudflareManual') : settings.cfTokenSet ? t('apiErrors.environment.cloudflareTokenSet') : t('apiErrors.environment.cloudflareMissing'),
      href: manual ? '/settings' : '/cloudflare', action: manual ? t('apiErrors.environment.viewAdvancedSettings') : t('apiErrors.environment.goConnect') },
    { key: 'domains', label: t('apiErrors.environment.stepDomains'), ok: active.length > 0,
      detail: active.length ? t('apiErrors.environment.domainsActive', { count: active.length }) : t('apiErrors.environment.domainsNone'),
      href: '/domains', action: t('apiErrors.environment.addDomain') },
    { key: 'dns', label: t('apiErrors.environment.stepDns'), ok: active.length > 0 && unverified.length === 0,
      detail: !active.length ? t('apiErrors.environment.dnsNoDomains') : unverified.length ? t('apiErrors.environment.dnsUnverified', { count: unverified.length }) : t('apiErrors.environment.dnsVerified', { count: active.length }),
      href: active.length === 1 ? `/environment?domain=${active[0].id}#domain-dns` : '/environment', action: t('apiErrors.environment.manageDns') },
    { key: 'panel-tls', label: t('apiErrors.environment.stepPanelTls'), ok: Boolean(panelTls?.ok),
      detail: !panelHost ? t('apiErrors.environment.panelHostMissing') : panelTls?.ok ? t('apiErrors.environment.panelCertValid', { host: panelHost, days: panelTls.daysLeft ?? 0 }) : `${panelHost} · ${panelTls?.error || t('apiErrors.environment.panelCertInactive')}`,
      href: '/panel-settings#tls', action: t('apiErrors.environment.managePanelCert') },
    { key: 'mail-tls', label: t('apiErrors.environment.stepMailTls'), ok: mailCertOk,
      detail: !mailHost ? t('apiErrors.environment.mailHostMissing') : mailCertOk ? t('apiErrors.environment.mailCertInstalled', { host: mailHost, days: mailCertificate?.daysRemaining ?? 0 }) : mailCertificate?.daysRemaining !== null && mailCertificate?.daysRemaining !== undefined
        ? t('apiErrors.environment.mailCertNotInstalled', { host: mailHost }) : t('apiErrors.environment.mailCertNotIssued', { host: mailHost }),
      href: '/panel-settings#tls', action: t('apiErrors.environment.manageMailCert') },
    { key: 'mail-rdns', label: t('apiErrors.environment.stepRdns'), ok: rdns.ok,
      detail: rdns.detail,
      href: '/panel-settings#mail-host', action: t('apiErrors.environment.viewMailHostSettings') },
    { key: 'mail-listener', label: t('apiErrors.environment.stepMailListener'), ok: mailPortsOk,
      detail: !mailHost ? t('apiErrors.environment.listenerNoHost') : mailPortsOk
        ? t('apiErrors.environment.listenerOk')
        : t('apiErrors.environment.listenerPorts', {
            smtp25: portStatus(mailPorts, 0, t), smtps465: portStatus(mailPorts, 1, t),
            submission587: portStatus(mailPorts, 2, t), imaps993: portStatus(mailPorts, 3, t),
            noMailbox: activeMailboxCount === 0 ? t('apiErrors.environment.listenerNoMailbox') : '',
          }),
      href: !mailHost ? '/panel-settings#mail-host' : activeMailboxCount === 0 ? '/mailboxes' : '/monitor/queue',
      action: !mailHost ? t('apiErrors.environment.configureMailHost') : activeMailboxCount === 0 ? t('apiErrors.environment.createMailbox') : t('apiErrors.environment.viewServiceStatus'),
      repair: Boolean(mailHost && !mailPortsOk) },
    { key: 'mail-smtp-egress', label: t('apiErrors.environment.stepSmtpEgress'), ok: smtpEgress.ok,
      detail: smtpEgress.detail,
      href: '/panel-settings#mail-host', action: t('apiErrors.environment.viewMailHostSettings') },
    { key: 'mail-service', label: t('apiErrors.environment.stepMailService'), ok: dms.ok,
      detail: dms.ok ? t('apiErrors.environment.mailServiceOk') : t('apiErrors.environment.mailServiceDown', { error: dms.error.slice(0, 150) }),
      href: '/monitor/queue', action: t('apiErrors.environment.viewServiceLogs') },
  ]
  return NextResponse.json({ checkedAt: new Date().toISOString(), steps, domains: dns.map(({ domain, state }) => ({
    id: domain.id, name: domain.name, active: domain.active, ownershipToken: domain.ownershipToken,
    mailHostname: getMailHostname(domain.mailHostname || `mail.${domain.name}`),
    mailboxCount: mailboxCounts.get(domain.id) ?? 0, ruleCount: ruleCountMap.get(domain.id) ?? 0,
    items: state.items ?? [], checkedAt: state.checkedAt ?? null,
  })), panelHost, mailHost, vpsIp: settings.vpsIp, dnsMode: manual ? 'manual' : 'cloudflare' }, { headers: { 'Cache-Control': 'no-store' } })
}

function portStatus(ports: Array<{ ok: boolean; error?: string }> | null, index: number, t: Translator) {
  const port = ports?.[index]
  return port?.ok ? t('apiErrors.environment.portOk') : port?.error || t('apiErrors.environment.portFailed')
}

async function checkOutboundSmtp25(t: Translator): Promise<{ ok: boolean; detail: string }> {
  try {
    const mx = (await resolveMx('gmail.com')).sort((a, b) => a.priority - b.priority).slice(0, 2)
    if (!mx.length) return { ok: false, detail: t('apiErrors.environment.egressMxUnresolved') }
    const checks = await Promise.all(mx.map(async (entry) => {
      const host = entry.exchange.replace(/\.$/, '')
      try {
        // Probe IPv4 explicitly so a host with broken/unavailable IPv6 is not
        // incorrectly reported as having outbound SMTP blocked.
        const { address } = await lookup(host, { family: 4 })
        return { host, address, result: await checkTcpPort(address, 25, 3500) }
      } catch (error) {
        return { host, address: '', result: { ok: false, error: error instanceof Error ? error.message : String(error) } }
      }
    }))
    const reachable = checks.find((entry) => entry.result.ok)
    if (reachable) return { ok: true, detail: t('apiErrors.environment.egressReachable', { host: reachable.host, address: reachable.address }) }
    const failures = checks.map((entry) => t('apiErrors.environment.egressEntry', {
      host: entry.address ? t('apiErrors.environment.egressHostWithAddress', { host: entry.host, address: entry.address }) : entry.host,
      error: entry.result.error || t('apiErrors.environment.egressConnectFailed'),
    })).join(t('apiErrors.environment.egressSeparator'))
    return { ok: false, detail: t('apiErrors.environment.egressBlocked', { failures }) }
  } catch (error) {
    return { ok: false, detail: t('apiErrors.environment.egressCheckFailed', { error: error instanceof Error ? error.message : String(error) }) }
  }
}

async function checkMailRdns(vpsIp: string, mailHost: string, t: Translator): Promise<{ ok: boolean; detail: string }> {
  if (!vpsIp) return { ok: false, detail: t('apiErrors.environment.rdnsNoVpsIp') }
  if (!isIPv4(vpsIp)) return { ok: false, detail: t('apiErrors.environment.rdnsInvalidIp', { ip: vpsIp }) }
  if (!mailHost) return { ok: false, detail: t('apiErrors.environment.rdnsNoMailHost') }
  try {
    const ptrs = await resolvePtr(vpsIp, t)
    if (!ptrs.length) return { ok: false, detail: t('apiErrors.environment.rdnsNoPtr', { ip: vpsIp, host: mailHost }) }
    const normalizedHost = mailHost.toLowerCase().replace(/\.$/, '')
    const matchingPtr = ptrs.includes(normalizedHost)
    const forward = matchingPtr ? await resolveA(normalizedHost, t) : []
    const forwardMatches = forward.includes(vpsIp)
    if (!matchingPtr) return { ok: false, detail: t('apiErrors.environment.rdnsWrongPtr', { ptrs: ptrs.join(t('apiErrors.dns.listSeparator')), host: mailHost }) }
    if (!forwardMatches) return { ok: false, detail: t('apiErrors.environment.rdnsNoForward', { host: mailHost, ip: vpsIp }) }
    return { ok: true, detail: t('apiErrors.environment.rdnsOk', { ip: vpsIp, host: mailHost }) }
  } catch (error) {
    return { ok: false, detail: t('apiErrors.environment.rdnsQueryFailed', { error: error instanceof Error ? error.message : String(error) }) }
  }
}

export async function POST() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  const [rows, vpsIp] = await Promise.all([db.select().from(domains), getVpsIp()])
  if (!vpsIp) return NextResponse.json({ error: t('apiErrors.environment.vpsIpMissing') }, { status: 400 })
  const results = await Promise.all(rows.filter((domain) => domain.active).map(async (domain) => {
    const dkimPublicKey = await resolveDkimPublicKey(domain.id, domain.name)
    const items = await runChecklist({ domain: domain.name, mailHostname: getMailHostname(domain.mailHostname || `mail.${domain.name}`),
      ownershipToken: domain.ownershipToken || '', vpsIp, dkimPublicKey }, t)
    await db.update(domains).set({ dnsStatus: JSON.stringify({ items, checkedAt: new Date().toISOString() }) }).where(eq(domains.id, domain.id))
    return { domain: domain.name, passed: items.filter((item) => item.ok).length, total: items.length }
  }))
  await audit(admin.username, 'environment.check', undefined, { domains: results })
  return NextResponse.json({ ok: true, domains: results })
}
