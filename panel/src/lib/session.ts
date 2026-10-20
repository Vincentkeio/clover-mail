import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** session = base64url(adminId.expiry.hmac(adminId.expiry))，无状态、服务端零存储 */
const COOKIE_NAME = 'clover_session'
const MAX_AGE_SECONDS = 60 * 60 * 12 // 12 小时

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 16 || s === 'change-me-to-random-32+' || s === 'dev-only-insecure-secret') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET 未设置或过短（≥16 字符），拒绝启动')
    }
    return 'dev-only-insecure-secret'
  }
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function credentialVersion(passwordHash: string | null): string {
  return createHash('sha256').update(passwordHash ?? '').digest('base64url')
}

export function createSessionToken(adminId: number, passwordHash: string | null): string {
  const payload = `${adminId}.${Date.now() + MAX_AGE_SECONDS * 1000}.${credentialVersion(passwordHash)}`
  const token = `${payload}.${sign(payload)}`
  return Buffer.from(token).toString('base64url')
}

export function verifySessionToken(token: string | undefined, passwordHash?: string | null): number | null {
  if (!token) return null
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts = decoded.split('.')
    if (parts.length !== 4) return null
    const [id, expiry, version, sig] = parts
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !/^\d+$/.test(expiry) || !version || !sig) return null
    if (passwordHash !== undefined && version !== credentialVersion(passwordHash)) return null
    if (!Number.isFinite(Number(expiry)) || Date.now() > Number(expiry)) return null
    const expected = sign(`${id}.${expiry}.${version}`)
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    return Number(id)
  } catch {
    return null
  }
}

export const sessionCookie = {
  name: COOKIE_NAME,
  maxAge: MAX_AGE_SECONDS,
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  },
}

/** M1 TODO: 开放 API token 体系（plan 6.7/6.8），与面板 session 分开 */
export function generateApiToken(): string {
  return randomBytes(32).toString('base64url')
}
