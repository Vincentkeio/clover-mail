import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createTranslator, type Translator } from '@/lib/i18n/translate'

type MaintenanceTicket = { job: string; panelHost: string; mailHost: string; origin: string; expires: number; action?: 'configure' | 'update' | 'restart' }
const lifetime = 15 * 60_000

function sign(payload: string, t: Translator = createTranslator('en')) {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 16) throw new Error(t('apiSystem.maintenance.sessionSecretMissing'))
  return createHmac('sha256', secret).update('maintenance-status:' + payload).digest('base64url')
}

export function issueMaintenanceTicket(details: Omit<MaintenanceTicket, 'expires'>, t: Translator = createTranslator('en')) {
  const payload = Buffer.from(JSON.stringify({ ...details, expires: Date.now() + (details.action === 'update' ? 45 * 60_000 : lifetime) })).toString('base64url')
  return payload + '.' + sign(payload, t)
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
