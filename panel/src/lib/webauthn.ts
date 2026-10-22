import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { sqlite } from '@/db'
import { credentialVersion } from './session'
import { DEFAULT_LOCALE } from './i18n/config'
import { createTranslator, type Translator } from './i18n/translate'

/**
 * WebAuthn（Passkey）公共设施：
 * - RP 参数从请求头推导（panel 域名），可用环境变量覆盖（真机多域名/反代场景）
 * - challenge 落库，短时随机 cookie（120s）定位；数据库原子消费防重放
 * - 凭据存 admins.webauthn_credentials（JSON 数组），容量极小、无需单表
 */

/** 调用方未传 Translator 时的兜底（默认语言），避免漏改调用点时丢文案。 */
const fallbackTranslator = createTranslator(DEFAULT_LOCALE)

export type StoredCredential = {
  id: string
  publicKey: string
  counter: number
  transports?: string[]
  deviceType?: string
  backedUp?: boolean
  name?: string
  createdAt: string
}

const CHALLENGE_COOKIE = 'clover_wa_challenge'
const CHALLENGE_TTL_MS = 120_000

type ChallengePurpose = 'login' | 'register'
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

/** rpName 会显示在系统 Passkey 弹窗里，跟随面板语言。 */
export async function getRpConfig(t: Translator = fallbackTranslator): Promise<{ rpID: string; origin: string; rpName: string }> {
  const envRpID = process.env.WEBAUTHN_RP_ID
  const envOrigin = process.env.WEBAUTHN_ORIGIN
  if (envRpID && envOrigin) {
    return { rpID: envRpID, origin: envOrigin, rpName: t('common.appTitle') }
  }

  const { headers } = await import('next/headers')
  const h = await headers()
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000').split(',')[0].trim()
  const proto = (h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'))
    .split(',')[0]
    .trim()
  const rpID = envRpID ?? host.split(':')[0]
  return { rpID, origin: envOrigin ?? `${proto}://${host}`, rpName: t('common.appTitle') }
}

/** Store purpose and password version as well as the challenge. */
export async function saveChallenge(username: string, challenge: string, purpose: ChallengePurpose, passwordHash: string | null): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  sqlite.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').run(now)
  sqlite.prepare('INSERT INTO auth_challenges (key, username, purpose, challenge, credential_version, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(digest(token), username, purpose, challenge, credentialVersion(passwordHash), now + CHALLENGE_TTL_MS)
  const store = await cookies()
  store.set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 120,
  })
}

/** DELETE RETURNING makes cookie and assertion replays fail across workers. */
export async function consumeChallenge(username: string, purpose: ChallengePurpose, passwordHash: string | null): Promise<string | null> {
  const store = await cookies()
  const raw = store.get(CHALLENGE_COOKIE)?.value
  store.delete(CHALLENGE_COOKIE)
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null
  const row = sqlite.prepare('DELETE FROM auth_challenges WHERE key = ? RETURNING username, purpose, challenge, credential_version, expires_at').get(digest(raw)) as {
    username: string; purpose: string; challenge: string; credential_version: string; expires_at: number
  } | undefined
  if (!row || row.username !== username || row.purpose !== purpose || row.expires_at <= Date.now()
    || row.credential_version !== credentialVersion(passwordHash)) return null
  return row.challenge
}

export function parseCredentials(json: string | null): StoredCredential[] {
  if (!json) return []
  try {
    const list = JSON.parse(json)
    return Array.isArray(list) ? (list as StoredCredential[]) : []
  } catch {
    return []
  }
}
