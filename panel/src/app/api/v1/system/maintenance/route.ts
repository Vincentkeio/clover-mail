import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve4 } from 'node:dns/promises'
import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { getVpsIp } from '@/lib/settings'
import { audit } from '@/lib/audit'
import { issueMaintenanceTicket } from '@/lib/maintenance-ticket'
import { getTranslator } from '@/lib/i18n/server'
import type { Translator } from '@/lib/i18n/translate'
import { hasTrustedOrigin } from '@/lib/request-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const run = promisify(execFile)
const JOB = 'clover-maintenance'

async function docker(args: string[], timeout = 12_000): Promise<string> {
  const result = await run('docker', args, { timeout, maxBuffer: 128 * 1024 })
  return result.stdout.trim()
}

async function projectDirectory(t: Translator): Promise<string> {
  const path = await docker(['inspect', 'clover-panel', '--format', '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'])
  if (!path.startsWith('/') || path.includes('..') || /[\r\n]/.test(path)) throw new Error(t('apiSystem.maintenance.projectDirUnknown'))
  return path
}

async function jobState() {
  try {
    const status = await docker(['inspect', JOB, '--format', '{{.State.Status}}|{{.State.ExitCode}}'])
    const [state, exitCode] = status.split('|')
    const logs = await docker(['logs', '--tail', '24', JOB]).catch(() => '')
    return { state, exitCode: Number(exitCode), logs: logs.slice(-9000) }
  } catch { return { state: 'idle', exitCode: null, logs: '' } }
}

function fqdn(value: string): boolean {
  return value.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(value)
    && !/(?:^|\.)(?:sslip|nip)\.io$/.test(value)
    && !/(?:^|\.)example\.(?:com|net|org)$/.test(value)
}

export async function GET() {
  if (!await getCurrentAdmin()) return unauthorized()
  const t = await getTranslator()
  const [job, hostInfo, image, project] = await Promise.all([
    jobState(),
    docker(['info', '--format', '{{.OperatingSystem}}|{{.Architecture}}|{{.NCPU}}|{{.MemTotal}}|{{.ServerVersion}}']).catch(() => ''),
    docker(['inspect', 'clover-panel', '--format', '{{.Config.Image}}']).catch(() => ''),
    projectDirectory(t).catch(() => ''),
  ])
  const digests = image ? await docker(['image', 'inspect', image, '--format', '{{json .RepoDigests}}']).catch(() => '[]') : '[]'
  const localBuild = project ? await docker(['exec', 'clover-certificate-helper', 'test', '-f', '/clover/.clover-local-build']).then(() => true).catch(() => false) : false
  const [os, architecture, cpus, memory, dockerVersion] = hostInfo.split('|')
  return NextResponse.json({
    panelHost: process.env.PANEL_HOSTNAME || process.env.PANEL_FQDN || '',
    mailHost: process.env.MAIL_HOSTNAME || process.env.MAIL_FQDN || '',
    vpsIp: await getVpsIp(),
    host: { os: os || '—', architecture: architecture || '—', cpus: Number(cpus) || null, memoryBytes: Number(memory) || null, dockerVersion: dockerVersion || '—' },
    image, sourceMode: localBuild || digests === '[]' || digests === 'null', maintenanceAvailable: Boolean(project), job,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  const origin = req.headers.get('origin')
  if (!hasTrustedOrigin(req.headers, req.url)) return NextResponse.json({ error: t('apiSystem.maintenance.badOrigin') }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  if (!['restart', 'update', 'configure'].includes(action)) return NextResponse.json({ error: t('apiSystem.maintenance.invalidAction') }, { status: 400 })
  if (action === 'update' && body.confirm !== true) return NextResponse.json({ error: t('apiSystem.maintenance.updateConfirmRequired') }, { status: 400 })
  const existing = await jobState()
  if (existing.state === 'running' || existing.state === 'created') return NextResponse.json({ error: t('apiSystem.maintenance.jobRunning') }, { status: 409 })
  let args: string[] = [action]
  if (action === 'configure') {
    const panelHost = String(body.panelHost || '').trim().toLowerCase()
    const mailHost = String(body.mailHost || '').trim().toLowerCase()
    const currentPanel = process.env.PANEL_HOSTNAME || process.env.PANEL_FQDN || ''
    const currentMail = process.env.MAIL_HOSTNAME || process.env.MAIL_FQDN || ''
    if ((!fqdn(panelHost) && panelHost !== currentPanel) || (!fqdn(mailHost) && mailHost !== currentMail) || panelHost === mailHost)
      return NextResponse.json({ error: t('apiSystem.maintenance.domainInvalid') }, { status: 400 })
    const vpsIp = await getVpsIp()
    if (vpsIp) {
      for (const host of [panelHost, mailHost]) {
        if (host === currentPanel || host === currentMail) continue
        const ips: string[] = await resolve4(host).catch(() => [] as string[])
        if (!ips.includes(vpsIp)) return NextResponse.json({ error: t('apiSystem.maintenance.aRecordMissing', { host, ip: vpsIp }) }, { status: 422 })
      }
    }
    args = [action, panelHost, mailHost]
  }
  try {
    const project = await projectDirectory(t)
    // Never remove a running job if another request started it after our check.
    if (existing.state !== 'idle') await docker(['rm', JOB])
    const id = await docker(['run', '-d', '--name', JOB,
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
      '-v', `${project}:${project}`, '-w', project,
      'docker:cli', 'sh', './scripts/maintenance.sh', ...args], 30_000)
    await audit(admin.username, `system.${action}`, action === 'configure' ? `${args[1]},${args[2]}` : undefined, { job: id.slice(0, 12) })
    const ticket = issueMaintenanceTicket({ job: id, action: action as 'configure' | 'update' | 'restart', panelHost: action === 'configure' ? args[1] : process.env.PANEL_HOSTNAME || process.env.PANEL_FQDN || '',
      mailHost: action === 'configure' ? args[2] : process.env.MAIL_HOSTNAME || process.env.MAIL_FQDN || '', origin: origin || new URL(req.url).origin }, t)
    return NextResponse.json({ ok: true, job: id.slice(0, 12), ticket, panelHost: action === 'configure' ? args[1] : undefined,
      message: action === 'configure' ? t('apiSystem.maintenance.configureStarted') : t('apiSystem.maintenance.started') }, { status: 202 })
  } catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : t('apiSystem.maintenance.startFailed') }, { status: 502 }) }
}
