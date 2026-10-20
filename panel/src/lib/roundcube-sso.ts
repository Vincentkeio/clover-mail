import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db, sqlite } from '@/db'
import { admins, domains, mailboxes } from '@/db/schema'
import { getGlobalMailSettings } from './settings'
import { getRoundcubeCredentials } from './roundcube-auth'
import { DEFAULT_LOCALE } from './i18n/config'
import { createTranslator, type Translator } from './i18n/translate'

/** 调用方未传 Translator 时的兜底（默认语言），避免漏改调用点时丢文案。 */
const fallbackTranslator = createTranslator(DEFAULT_LOCALE)

const prefix = 'roundcube_sso_ticket_'
const digest = (ticket: string) => createHash('sha256').update(ticket).digest('hex')
export function validRoundcubeKey(value: string | null) {
  const expected = process.env.ROUNDCUBE_SSO_SECRET || ''
  if (expected.length < 32 || !value) return false
  const left = Buffer.from(value), right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
export async function assertRoundcubeMailbox(login: string, t: Translator = fallbackTranslator) {
  const [box] = await db.select({ login: mailboxes.login }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(and(eq(mailboxes.login, login), eq(mailboxes.active, true), eq(domains.active, true))).limit(1)
  const policy = await getGlobalMailSettings()
  if (!box || !policy.allowImap) throw new Error(t('apiAuth.roundcube.mailboxUnavailable'))
}
export async function issueRoundcubeTicket(login: string, adminId: number, t: Translator = fallbackTranslator) {
  if (!validRoundcubeKey(process.env.ROUNDCUBE_SSO_SECRET || null)) throw new Error(t('apiAuth.roundcube.ssoKeyMissing'))
  await assertRoundcubeMailbox(login, t)
  await getRoundcubeCredentials(t)
  const ticket = randomBytes(32).toString('base64url')
  const expires = Date.now() + 60_000
  // Expire abandoned tickets without touching other settings.
  const abandoned = sqlite.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all(prefix + '%') as Array<{ key: string; value: string }>
  const remove = sqlite.prepare('DELETE FROM settings WHERE key = ?')
  for (const row of abandoned) {
    try { if (JSON.parse(row.value).expires < Date.now()) remove.run(row.key) } catch { remove.run(row.key) }
  }
  sqlite.prepare('INSERT INTO settings (key, value, sensitive, updated_at) VALUES (?, ?, 0, ?)').run(prefix + digest(ticket), JSON.stringify({ login, adminId, expires }), new Date().toISOString())
  return ticket
}
export async function consumeRoundcubeTicket(ticket: string, t: Translator = fallbackTranslator) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error(t('apiAuth.roundcube.invalidTicket'))
  // DELETE RETURNING consumes the ticket atomically; concurrent replays cannot succeed.
  const row = sqlite.prepare('DELETE FROM settings WHERE key = ? RETURNING value').get(prefix + digest(ticket)) as { value: string } | undefined
  if (!row) throw new Error(t('apiAuth.roundcube.ticketUsed'))
  const data = JSON.parse(row.value) as { login: string; adminId: number; expires: number }
  if (!data.expires || data.expires < Date.now()) throw new Error(t('apiAuth.roundcube.ticketExpired'))
  const [admin] = await db.select({ id: admins.id }).from(admins).where(eq(admins.id, data.adminId)).limit(1)
  if (!admin) throw new Error(t('apiAuth.roundcube.adminSessionExpired'))
  await assertRoundcubeMailbox(data.login, t)
  return { login: data.login, ...await getRoundcubeCredentials(t) }
}
