import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { verifyMaintenanceTicket } from '@/lib/maintenance-ticket'
import { getTranslator } from '@/lib/i18n/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const run = promisify(execFile)

export async function GET(request: Request) {
  const t = await getTranslator()
  const ticket = verifyMaintenanceTicket(new URL(request.url).searchParams.get('ticket'))
  if (!ticket) return Response.json({ error: t('apiSystem.maintenance.ticketExpired') }, { status: 403 })
  const origin = request.headers.get('origin')
  if (origin && origin !== ticket.origin) return new Response(null, { status: 403 })
  const headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': ticket.origin, Vary: 'Origin' }
  try {
    const [jobResult, panelResult] = await Promise.all([
      run('docker', ['inspect', ticket.job, '--format', '{{json .State}}'], { timeout: 5000, maxBuffer: 8192 }),
      run('docker', ['inspect', 'clover-panel', '--format', '{{json .}}'], { timeout: 5000, maxBuffer: 128 * 1024 }),
    ])
    const job = JSON.parse(jobResult.stdout) as { Status: string; ExitCode: number }
    const panel = JSON.parse(panelResult.stdout) as { Config: { Env: string[] }; State: { Health?: { Status: string } } }
    const environment = panel.Config.Env
    const configured = environment.includes('PANEL_HOSTNAME=' + ticket.panelHost) && environment.includes('MAIL_HOSTNAME=' + ticket.mailHost)
    const ready = job.Status === 'exited' && job.ExitCode === 0 && (ticket.action === 'update' || ticket.action === 'restart' || configured) && panel.State.Health?.Status === 'healthy'
    // Never expose job logs, container environment, or credentials to this endpoint.
    return Response.json({ state: job.Status, exitCode: job.Status === 'exited' ? job.ExitCode : null, ready, configured }, { headers })
  } catch {
    return Response.json({ state: 'reconnecting', ready: false }, { status: 503, headers })
  }
}
