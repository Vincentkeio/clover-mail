import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db, sqlite } from '@/db'
import { admins, domains, mailboxes } from '@/db/schema'
import { getGlobalMailSettings } from './settings'
import { getRoundcubeCredentials } from './roundcube-auth'

const prefix = 'roundcube_sso_ticket_'
const digest = (ticket: string) => createHash('sha256').update(ticket).digest('hex')
export function validRoundcubeKey(value: string | null) {
  const expected = process.env.ROUNDCUBE_SSO_SECRET || ''
  if (expected.length < 32 || !value) return false
  const left = Buffer.from(value), right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
export async function assertRoundcubeMailbox(login: string) {
  const [box] = await db.select({ login: mailboxes.login }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(and(eq(mailboxes.login, login), eq(mailboxes.active, true), eq(domains.active, true))).limit(1)
  const policy = await getGlobalMailSettings()
  if (!box || !policy.allowImap) throw new Error('邮箱不存在、已停用或全局 IMAP 已关闭。')
}
export async function issueRoundcubeTicket(login: string, adminId: number) {
  if (!validRoundcubeKey(process.env.ROUNDCUBE_SSO_SECRET || null)) throw new Error('Roundcube 免密密钥尚未配置，请运行 Clover 更新或修复部署。')
  await assertRoundcubeMailbox(login)
  await getRoundcubeCredentials()
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
export async function consumeRoundcubeTicket(ticket: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error('无效的登录凭据。')
  // DELETE RETURNING consumes the ticket atomically; concurrent replays cannot succeed.
  const row = sqlite.prepare('DELETE FROM settings WHERE key = ? RETURNING value').get(prefix + digest(ticket)) as { value: string } | undefined
  if (!row) throw new Error('登录凭据已使用或已失效，请从面板重新进入。')
  const data = JSON.parse(row.value) as { login: string; adminId: number; expires: number }
  if (!data.expires || data.expires < Date.now()) throw new Error('登录凭据已过期，请从面板重新进入。')
  const [admin] = await db.select({ id: admins.id }).from(admins).where(eq(admins.id, data.adminId)).limit(1)
  if (!admin) throw new Error('面板管理员会话已失效。')
  await assertRoundcubeMailbox(data.login)
  return { login: data.login, ...await getRoundcubeCredentials() }
}
