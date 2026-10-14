import { NextResponse } from 'next/server'
import { isIPv4 } from 'node:net'
import { lookup, resolveMx } from 'node:dns/promises'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { checkTcpPort, readCertificate } from '@/lib/certificate-probe'
import { readCertificateHelperStatus } from '@/lib/certificate-status'
import { resolveA, resolvePtr, runChecklist } from '@/lib/dns-check'
import { resolveDkimPublicKey } from '@/lib/dkim'
import { supervisorStatus } from '@/lib/dms'
import { getMailHostname, getPanelSettings, getSetting, getVpsIp } from '@/lib/settings'
import { audit } from '@/lib/audit'

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

  const [settings, domainRows, dnsMode, dms, mailboxRows, helperStatus] = await Promise.all([
    getPanelSettings(), db.select().from(domains).orderBy(asc(domains.id)), getSetting('dns_mode'), supervisorStatus(),
    db.select().from(mailboxes), readCertificateHelperStatus().catch(() => null),
  ])
  const panelHost = process.env.PANEL_HOSTNAME || process.env.PANEL_FQDN || ''
  const mailHost = getMailHostname()
  const sharedCaddy = process.env.CLOVER_SHARED_CADDY === '1'
  const sharedNginx = process.env.CLOVER_SHARED_NGINX === '1' || (process.env.CLOVER_CADDY_SCHEME === 'http' && !sharedCaddy)
  const [panelTls, mailPorts, smtpEgress] = await Promise.all([
    panelHost ? readCertificate(sharedNginx || sharedCaddy ? 'host.docker.internal' : 'caddy', 443, panelHost) : null,
    mailHost ? Promise.all([25, 465, 587, 993].map((port) => checkTcpPort(process.env.DMS_CONTAINER || 'docker-mailserver', port))) : null,
    checkOutboundSmtp25(),
  ])
  const mailCertificate = helperStatus?.certificates?.mail
  const mailCertOk = Boolean(mailCertificate?.installed && mailCertificate.daysRemaining !== null && mailCertificate.daysRemaining >= 0)
  const mailPortsOk = Boolean(mailPorts?.every((port) => port.ok))
  const rdns = await checkMailRdns(settings.vpsIp, mailHost)
  const activeMailboxCount = mailboxRows.filter((mailbox) => mailbox.active).length
  const active = domainRows.filter((domain) => domain.active)
  const dns = active.map((domain) => ({ domain, state: dnsState(domain.dnsStatus) }))
  const unverified = dns.filter(({ state }) => !state.items?.length || state.items.some((item) => !item.ok))
  const manual = dnsMode === 'manual'
  const steps: Step[] = [
    { key: 'cloudflare', label: 'Cloudflare 连接', ok: manual || settings.cfTokenSet,
      detail: manual ? '已选择手动 DNS 模式' : settings.cfTokenSet ? 'API Token 已保存' : '还没有连接 Cloudflare，请添加 API Token',
      href: manual ? '/settings' : '/cloudflare', action: manual ? '查看高级设置' : '前往连接' },
    { key: 'domains', label: '域名配置', ok: active.length > 0,
      detail: active.length ? `已启用 ${active.length} 个邮件域名` : '还没有邮件域名，请先添加域名',
      href: '/domains', action: '管理域名' },
    { key: 'dns', label: 'DNS 记录', ok: active.length > 0 && unverified.length === 0,
      detail: !active.length ? '添加域名后即可生成与检查 DNS' : unverified.length ? `${unverified.length} 个域名尚未通过全部 DNS 检查` : `${active.length} 个域名的 DNS 检查已通过`,
      href: active.length === 1 ? `/domains/${active[0].id}?tab=dns` : '/domains', action: '查看 DNS' },
    { key: 'panel-tls', label: '面板 TLS', ok: Boolean(panelTls?.ok),
      detail: !panelHost ? '面板域名未配置' : panelTls?.ok ? `${panelHost} · 证书有效，剩余 ${panelTls.daysLeft} 天` : `${panelHost} · ${panelTls?.error || '证书未生效'}`,
      href: '/panel-settings#tls', action: '管理面板证书' },
    { key: 'mail-tls', label: '邮件服务 TLS', ok: mailCertOk,
      detail: !mailHost ? '邮件主机名未配置' : mailCertOk ? `${mailHost} · 证书已安装，剩余 ${mailCertificate?.daysRemaining} 天` : mailCertificate?.daysRemaining !== null && mailCertificate?.daysRemaining !== undefined
        ? `${mailHost} · 证书尚未安装到邮件服务` : `${mailHost} · 证书尚未签发`,
      href: '/panel-settings#tls', action: '管理邮件证书' },
    { key: 'mail-rdns', label: '邮件服务器 rDNS（PTR）', ok: rdns.ok,
      detail: rdns.detail,
      href: '/panel-settings#mail-host', action: '查看邮件主机设置' },
    { key: 'mail-listener', label: '邮件端口监听', ok: mailPortsOk,
      detail: !mailHost ? '邮件服务器域名尚未配置。请到「面板设置 → 面板与邮件主机」填写邮件主机名。' : mailPortsOk
        ? '面板容器可连接邮件服务的 25 SMTP、465 SMTPS、587 SMTP 提交与 993 IMAPS。外部邮件能否连入 25，还取决于 VPS 服务商的入站网络规则。'
        : `面板到邮件服务的端口监听检查（25 SMTP 收信：${portStatus(mailPorts, 0)}；465 SMTPS：${portStatus(mailPorts, 1)}；587 SMTP 提交：${portStatus(mailPorts, 2)}；993 IMAPS：${portStatus(mailPorts, 3)}）${activeMailboxCount === 0 ? '。没有启用邮箱时，Dovecot 可能尚未启动' : ''}`,
      href: !mailHost ? '/panel-settings#mail-host' : activeMailboxCount === 0 ? '/mailboxes' : '/monitor/queue',
      action: !mailHost ? '配置邮件主机名' : activeMailboxCount === 0 ? '创建邮箱账户' : '查看服务状态',
      repair: Boolean(mailHost && !mailPortsOk) },
    { key: 'mail-smtp-egress', label: 'SMTP 25 出站', ok: smtpEgress.ok,
      detail: smtpEgress.detail,
      href: '/panel-settings#mail-host', action: '查看邮件主机设置' },
    { key: 'mail-service', label: '邮件服务', ok: dms.ok,
      detail: dms.ok ? '邮件服务进程可读取' : `邮件服务不可用：${dms.error.slice(0, 150)}`,
      href: '/monitor/queue', action: '查看服务日志' },
  ]
  return NextResponse.json({ checkedAt: new Date().toISOString(), steps, domains: dns.map(({ domain, state }) => ({
    id: domain.id, name: domain.name,
    active: domain.active, items: state.items ?? [], checkedAt: state.checkedAt ?? null,
  })), panelHost, mailHost, vpsIp: settings.vpsIp, dnsMode: manual ? 'manual' : 'cloudflare' }, { headers: { 'Cache-Control': 'no-store' } })
}

function portStatus(ports: Array<{ ok: boolean; error?: string }> | null, index: number) {
  const port = ports?.[index]
  return port?.ok ? '正常' : port?.error || '失败'
}

async function checkOutboundSmtp25(): Promise<{ ok: boolean; detail: string }> {
  try {
    const mx = (await resolveMx('gmail.com')).sort((a, b) => a.priority - b.priority).slice(0, 2)
    if (!mx.length) return { ok: false, detail: '无法解析公网邮件服务器 MX，暂时不能检测外发 TCP 25。请检查 VPS DNS/网络。' }
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
    if (reachable) return { ok: true, detail: `已从面板容器连通公网 MX ${reachable.host}（${reachable.address}）:25，外发 SMTP 网络通道可用。` }
    const failures = checks.map((entry) => `${entry.host}${entry.address ? `（${entry.address}）` : ''}: ${entry.result.error || '连接失败'}`).join('；')
    return { ok: false, detail: `无法从面板容器连接公网 MX 的 TCP 25（${failures}）。外发邮件可能被本机接受后排队，无法送达。请联系 VPS 服务商开放出站 TCP 25；若服务商不开放，需配置 SMTP 中继。` }
  } catch (error) {
    return { ok: false, detail: `公网 SMTP 25 检查失败：${error instanceof Error ? error.message : String(error)}。请确认 VPS 可解析 DNS，并联系服务商核实出站 TCP 25。` }
  }
}

async function checkMailRdns(vpsIp: string, mailHost: string): Promise<{ ok: boolean; detail: string }> {
  if (!vpsIp) return { ok: false, detail: '尚未设置 VPS 公网 IP。请先到「面板设置 → 面板与邮件主机」配置服务器 IP。' }
  if (!isIPv4(vpsIp)) return { ok: false, detail: `当前服务器 IP「${vpsIp}」不是有效的 IPv4 地址，暂时无法检查 PTR。请在面板设置中修正 VPS 公网 IP。` }
  if (!mailHost) return { ok: false, detail: '尚未配置邮件主机名。请先到「面板设置 → 面板与邮件主机」设置主机名。' }
  try {
    const ptrs = await resolvePtr(vpsIp)
    if (!ptrs.length) return { ok: false, detail: `IP ${vpsIp} 尚无 PTR（rDNS）记录。请联系 VPS 服务商，将此 IP 的反向解析设置为 ${mailHost}。` }
    const normalizedHost = mailHost.toLowerCase().replace(/\.$/, '')
    const matchingPtr = ptrs.includes(normalizedHost)
    const forward = matchingPtr ? await resolveA(normalizedHost) : []
    const forwardMatches = forward.includes(vpsIp)
    if (!matchingPtr) return { ok: false, detail: `当前 PTR 为 ${ptrs.join('、')}，应设置为 ${mailHost}。请联系 VPS 服务商修改此 IP 的反向解析。` }
    if (!forwardMatches) return { ok: false, detail: `PTR 已指向 ${mailHost}，但该主机 A 记录未解析回 ${vpsIp}。请修正 A 记录后重新检查。` }
    return { ok: true, detail: `${vpsIp} 的 PTR 指向 ${mailHost}，且该主机 A 记录解析回此 IP。` }
  } catch (error) {
    return { ok: false, detail: `rDNS 查询失败：${error instanceof Error ? error.message : String(error)}。请稍后重试；若 PTR 不匹配，请联系 VPS 服务商设置。` }
  }
}

export async function POST() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const [rows, vpsIp] = await Promise.all([db.select().from(domains), getVpsIp()])
  if (!vpsIp) return NextResponse.json({ error: '请先在面板设置填写 VPS 公网 IP' }, { status: 400 })
  const results = await Promise.all(rows.filter((domain) => domain.active).map(async (domain) => {
    const dkimPublicKey = await resolveDkimPublicKey(domain.id, domain.name)
    const items = await runChecklist({ domain: domain.name, mailHostname: getMailHostname(domain.mailHostname || `mail.${domain.name}`),
      ownershipToken: domain.ownershipToken || '', vpsIp, dkimPublicKey })
    await db.update(domains).set({ dnsStatus: JSON.stringify({ items, checkedAt: new Date().toISOString() }) }).where(eq(domains.id, domain.id))
    return { domain: domain.name, passed: items.filter((item) => item.ok).length, total: items.length }
  }))
  await audit(admin.username, 'environment.check', undefined, { domains: results })
  return NextResponse.json({ ok: true, domains: results })
}
