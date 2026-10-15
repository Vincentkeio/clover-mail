import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

type MaintenanceTicket = { job: string; panelHost: string; mailHost: string; origin: string; expires: number }
const lifetime = 15 * 60_000

function sign(payload: string) {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 16) throw new Error('面板会话密钥尚未配置。')
  return createHmac('sha256', secret).update('maintenance-status:' + payload).digest('base64url')
}

export function issueMaintenanceTicket(details: Omit<MaintenanceTicket, 'expires'>) {
  const payload = Buffer.from(JSON.stringify({ ...details, expires: Date.now() + lifetime })).toString('base64url')
  return payload + '.' + sign(payload)
}

/** Read-only, short-lived status access survives a panel restart/domain change. */
export function verifyMaintenanceTicket(value: string | null): MaintenanceTicket | null {
  if (!value || value.length > 4096) return null
  try {
    const [payload, signature, extra] = value.split('.')
    if (!payload || !signature || extra !== undefined) return null
    const expected = Buffer.from(sign(payload)), actual = Buffer.from(signature)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString()) as MaintenanceTicket
    if (!/^[a-f0-9]{64}$/.test(ticket.job) || !ticket.panelHost || !ticket.mailHost
      || !Number.isFinite(ticket.expires) || ticket.expires < Date.now()
      || !['http:', 'https:'].includes(new URL(ticket.origin).protocol)) return null
    return ticket
  } catch { return null }
}
