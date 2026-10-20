import { createHash } from 'node:crypto'
import { sqlite } from '@/db'

const WINDOW_MS = 15 * 60_000
const ACCOUNT_LIMIT = 10
const GLOBAL_LIMIT = 120

// SQLite makes reservations atomic across concurrent requests and Next workers,
// and retains limits across process restarts. No passwords or raw names are stored.
export function reserveLoginAttempt(username: string, now = Date.now()): number {
  const accountKey = 'account:' + createHash('sha256').update(username.toLowerCase()).digest('hex')
  return sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM auth_rate_limits WHERE expires_at <= ?').run(now)
    const subjects = [{ key: 'global', limit: GLOBAL_LIMIT }, { key: accountKey, limit: ACCOUNT_LIMIT }]
    const read = sqlite.prepare('SELECT attempts, expires_at FROM auth_rate_limits WHERE key = ?')
    const rows = subjects.map((subject) => ({ ...subject, row: read.get(subject.key) as { attempts: number; expires_at: number } | undefined }))
    const retryAfter = Math.max(0, ...rows.map(({ row, limit }) => row && row.attempts >= limit ? Math.ceil((row.expires_at - now) / 1000) : 0))
    if (retryAfter) return retryAfter
    const reserve = sqlite.prepare('INSERT INTO auth_rate_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1')
    for (const { key } of subjects) reserve.run(key, now + WINDOW_MS)
    return 0
  })()
}

export function clearLoginAttempts(username: string) {
  sqlite.prepare('DELETE FROM auth_rate_limits WHERE key = ?').run('account:' + createHash('sha256').update(username.toLowerCase()).digest('hex'))
}

export function limitLogin(username: string): Response | null {
  const retryAfter = reserveLoginAttempt(username)
  return retryAfter ? Response.json({ error: 'too_many_attempts' }, {
    status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
  }) : null
}
