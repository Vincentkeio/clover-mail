import tls from 'node:tls'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { readCertificateHelperStatus } from '@/lib/certificate-status'
import { NextResponse } from 'next/server'
import { getTranslator } from '@/lib/i18n/server'
import type { Translator } from '@/lib/i18n/translate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 600
const execFileAsync = promisify(execFile)

type Probe = {
  host: string
  port: number
  ok: boolean
  authorized?: boolean
  subject?: string
  issuer?: string
  validFrom?: string
  validTo?: string
  daysLeft?: number
  fingerprint?: string
  installed?: boolean
  error?: string
}

function readCertificate(host: string, port: number, servername: string, t: Translator): Promise<Probe> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername, rejectUnauthorized: false, timeout: 7000 }, () => {
      const cert = socket.getPeerCertificate()
      const validTo = cert.valid_to ? new Date(cert.valid_to) : null
      const daysLeft = validTo ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000) : undefined
      const subjectValue = cert.subject?.CN || cert.subject?.O || ''
      const issuerValue = cert.issuer?.CN || cert.issuer?.O || ''
      const subject = Array.isArray(subjectValue) ? subjectValue.join(', ') : subjectValue
      const issuer = Array.isArray(issuerValue) ? issuerValue.join(', ') : issuerValue
      socket.end()
      resolve({
        host: servername,
        port,
        ok: Boolean(cert.raw && daysLeft !== undefined && daysLeft >= 0),
        authorized: socket.authorized,
        subject,
        issuer,
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        daysLeft,
        fingerprint: cert.fingerprint256,
        ...(!socket.authorized && socket.authorizationError ? { error: String(socket.authorizationError) } : {}),
      })
    })
    socket.once('timeout', () => socket.destroy(new Error(t('apiAuth.certificates.connectTimeout'))))
    socket.once('error', (error) => resolve({ host: servername, port, ok: false, error: error.message }))
  })
}

async function runCertificateHelper(action: 'issue' | 'issue-mail', t: Translator): Promise<void> {
  try {
    await execFileAsync('docker', ['exec', 'clover-certificate-helper', 'python3', '/app/certificates.py', action], {
      timeout: 8 * 60 * 1000, maxBuffer: 2 * 1024 * 1024,
    })
  } catch (error) {
    const result = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
    const detail = (result.stderr || result.stdout || result.message || t('apiAuth.certificates.unknownError')).trim().slice(-1800)
    throw new Error(detail.includes('No such file or directory') && detail.includes('docker')
      ? t('apiAuth.certificates.helperUnavailable')
      : detail)
  }
}

export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const t = await getTranslator()
  const panelHost = process.env.PANEL_HOSTNAME || process.env.PANEL_FQDN || ''
  const mailHost = process.env.MAIL_HOSTNAME || process.env.MAIL_FQDN || ''
  if (!panelHost) return NextResponse.json({ error: t('apiAuth.certificates.panelHostMissing') }, { status: 503 })

  const checks: Probe[] = []
  const sharedCaddy = process.env.CLOVER_SHARED_CADDY === '1'
  const sharedNginx = process.env.CLOVER_SHARED_NGINX === '1' || (process.env.CLOVER_CADDY_SCHEME === 'http' && !sharedCaddy)
  const sharedIngress = sharedNginx || sharedCaddy
  checks.push(await readCertificate(sharedIngress ? 'host.docker.internal' : 'caddy', 443, panelHost, t))
  let helperStatus: Awaited<ReturnType<typeof readCertificateHelperStatus>> | undefined
  if (mailHost) {
    let helperError = ''
    try { helperStatus = await readCertificateHelperStatus() }
    catch (error) { helperError = error instanceof Error ? error.message : String(error) }
    const managedMail = helperStatus?.certificates?.mail
    const daysLeft = managedMail?.daysRemaining ?? undefined
    checks.push({
      host: mailHost, port: 465,
      ok: Boolean(managedMail?.installed && daysLeft !== undefined && daysLeft >= 0),
      installed: managedMail?.installed ?? false,
      ...(managedMail?.validFrom ? { validFrom: managedMail.validFrom } : {}),
      ...(managedMail?.validTo ? { validTo: managedMail.validTo } : {}),
      ...(daysLeft !== undefined ? { daysLeft } : {}),
      ...(managedMail?.issuer ? { issuer: managedMail.issuer } : {}),
      ...(managedMail?.subject ? { subject: managedMail.subject } : {}),
      ...(managedMail?.fingerprint ? { fingerprint: managedMail.fingerprint } : {}),
      ...(!managedMail?.installed ? { error: helperError || helperStatus?.error || t('apiAuth.certificates.mailCertNotInstalled') } : {}),
    })
  }

  return NextResponse.json({
    checkedAt: new Date().toISOString(), panelHost, mailHost, checks,
    certificateTask: helperStatus ? {
      running: Boolean(helperStatus.running), message: helperStatus.message || '',
      error: helperStatus.error || null, updatedAt: helperStatus.updatedAt || null,
    } : null,
    renewal: { enabled: true,
      manager: t('apiAuth.certificates.managerCombined', {
        panel: t('apiAuth.certificates.managerPanel', {
          proxy: sharedCaddy ? t('apiAuth.certificates.proxyHostCaddy')
            : sharedNginx ? t('apiAuth.certificates.proxyHostNginx') : t('apiAuth.certificates.proxyCloverCaddy'),
        }),
        mail: t('apiAuth.certificates.managerMail'),
      }),
      challenge: sharedCaddy ? t('apiAuth.certificates.challengeCaddy') : 'HTTP-01',
      ports: sharedCaddy ? [80, 443] : [80], acmeEmail: process.env.ACME_EMAIL || null },
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  const body = await req.json().catch(() => ({}))
  const target = body?.target
  if (target !== 'panel' && target !== 'mail') return NextResponse.json({ error: t('apiAuth.certificates.invalidTarget') }, { status: 400 })

  const host = target === 'panel'
    ? (process.env.PANEL_HOSTNAME || process.env.PANEL_FQDN || '')
    : (process.env.MAIL_HOSTNAME || process.env.MAIL_FQDN || '')
  if (!host) return NextResponse.json({ error: target === 'panel' ? t('apiAuth.certificates.panelHostMissing') : t('apiAuth.certificates.mailHostMissing') }, { status: 503 })

  const sharedCaddy = process.env.CLOVER_SHARED_CADDY === '1'
  const sharedNginx = process.env.CLOVER_SHARED_NGINX === '1' || (process.env.CLOVER_CADDY_SCHEME === 'http' && !sharedCaddy)
  if (target === 'mail') {
    try {
      const status = await readCertificateHelperStatus()
      if (status.running) {
        return NextResponse.json({ error: status.message || t('apiAuth.certificates.taskRunning') }, { status: 409 })
      }
      // Return before the worker starts; legacy standalone challenge modes may
      // briefly pause the reverse proxy that serves this panel request.
      await execFileAsync('docker', [
        'exec', '-d', 'clover-certificate-helper', 'sh', '-c',
        'sleep 3; exec python3 /app/certificates.py issue-mail',
      ], { timeout: 15_000, maxBuffer: 256 * 1024 })
    } catch (error) {
      const message = error instanceof Error ? error.message : t('apiAuth.certificates.helperRunFailed')
      await audit(admin.username, 'certificate.issue_check', host, { target, ok: false, error: message.slice(0, 500) })
      return NextResponse.json({ error: message }, { status: 502 })
    }
    await audit(admin.username, 'certificate.issue_check', host, { target, ok: true, queued: true })
    return NextResponse.json({ ok: true, host,
      running: true, queuedAt: new Date().toISOString(),
      message: sharedCaddy
        ? t('apiAuth.certificates.mailTaskStartedSharedCaddy')
        : t('apiAuth.certificates.mailTaskStarted'),
    }, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  }

  if (sharedNginx || sharedCaddy) {
    try {
      await runCertificateHelper('issue', t)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('apiAuth.certificates.helperRunFailed')
      await audit(admin.username, 'certificate.issue_check', host, { target, ok: false, error: message.slice(0, 500) })
      return NextResponse.json({ error: message }, { status: 502 })
    }
    const endpoint = { host: 'host.docker.internal', port: 443 }
    let live: Probe | undefined
    const deadline = Date.now() + 45_000
    do {
      live = await readCertificate(endpoint.host, endpoint.port, host, t)
      if (live.authorized && (live.daysLeft ?? -1) >= 0) break
      if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1500))
    } while (Date.now() < deadline)
    await audit(admin.username, 'certificate.issue_check', host, { target, ok: Boolean(live?.authorized) })
    if (!live?.authorized) {
      const reason = live?.error ? t('apiAuth.certificates.currentServiceError', { error: live.error }) : t('apiAuth.certificates.noTrustedCertificate')
      return NextResponse.json({ error: t('apiAuth.certificates.hintDomainRecord', { reason }) }, { status: 502 })
    }
    return NextResponse.json({ ok: true, host, message: target === 'mail'
      ? t('apiAuth.certificates.mailCertInstalled')
      : sharedCaddy
        ? t('apiAuth.certificates.panelCertByHostCaddy')
        : t('apiAuth.certificates.panelCertByHostNginx'), certificate: live }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // The TLS handshake asks Caddy's automatic certificate manager to provision a
  // missing certificate, or evaluate renewal when its renewal window is reached.
  // A first issuance is asynchronous, so retry briefly while Caddy completes ACME.
  let caddyProbe: Probe | undefined
  const issueDeadline = Date.now() + 30_000
  do {
    caddyProbe = await readCertificate(sharedCaddy ? 'host.docker.internal' : 'caddy', 443, host, t)
    if (caddyProbe.validTo) break
    if (Date.now() < issueDeadline) await new Promise((resolve) => setTimeout(resolve, 1500))
  } while (Date.now() < issueDeadline)
  if (!caddyProbe.validTo) {
    const reason = caddyProbe.error || t('apiAuth.certificates.certificateMissing', { proxy: sharedCaddy ? t('apiAuth.certificates.proxyHostCaddy') : 'Caddy' })
    return NextResponse.json({ error: t('apiAuth.certificates.hintDns', { reason }) }, { status: 502 })
  }

  const endpoint = { host: sharedCaddy ? 'host.docker.internal' : 'caddy', port: 443 }
  let live: Probe | undefined
  const deadline = Date.now() + 15_000
  do {
    live = await readCertificate(endpoint.host, endpoint.port, host, t)
    if (live.authorized && (live.daysLeft ?? -1) >= 0) break
    await new Promise((resolve) => setTimeout(resolve, 1000))
  } while (Date.now() < deadline)

  await audit(admin.username, 'certificate.issue_check', host, { target, ok: Boolean(live?.authorized) })
  if (!live?.authorized) {
    const reason = live?.error ? t('apiAuth.certificates.currentServiceError', { error: live.error }) : t('apiAuth.certificates.noTrustedCertificate')
    return NextResponse.json({ error: t('apiAuth.certificates.hintCaddyRequest', { reason }) }, { status: 502 })
  }

  const days = live.daysLeft ?? 0
  const message = days <= 30
    ? t('apiAuth.certificates.issueChecked')
    : t('apiAuth.certificates.certificateValid')
  return NextResponse.json({ ok: true, host, message, certificate: live }, { headers: { 'Cache-Control': 'no-store' } })
}
