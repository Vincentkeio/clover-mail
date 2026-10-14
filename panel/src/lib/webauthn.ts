import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

/**
 * WebAuthn（Passkey）公共设施：
 * - RP 参数从请求头推导（panel 域名），可用环境变量覆盖（真机多域名/反代场景）
 * - challenge 不落库：HMAC 签名的短时 cookie（120s）承载，防篡改
 * - 凭据存 admins.webauthn_credentials（JSON 数组），容量极小、无需单表
 */

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

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 16) throw new Error('SESSION_SECRET 未设置或过短，无法进行 WebAuthn 校验')
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export async function getRpConfig(): Promise<{ rpID: string; origin: string; rpName: string }> {
  const envRpID = process.env.WEBAUTHN_RP_ID
  const envOrigin = process.env.WEBAUTHN_ORIGIN
  if (envRpID && envOrigin) {
    return { rpID: envRpID, origin: envOrigin, rpName: 'clover 三叶草邮局' }
  }

  const { headers } = await import('next/headers')
  const h = await headers()
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000').split(',')[0].trim()
  const proto = (h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'))
    .split(',')[0]
    .trim()
  const rpID = envRpID ?? host.split(':')[0]
  return { rpID, origin: envOrigin ?? `${proto}://${host}`, rpName: 'clover 三叶草邮局' }
}

/** 写入 challenge cookie（httpOnly，120s） */
export async function saveChallenge(username: string, challenge: string): Promise<void> {
  const payload = `${username}.${Date.now() + CHALLENGE_TTL_MS}.${challenge}`
  const token = Buffer.from(`${payload}.${sign(payload)}`).toString('base64url')
  const store = await cookies()
  store.set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 120,
  })
}

/** 读取并校验 challenge（一次性：校验成功后立即清除） */
export async function consumeChallenge(username: string): Promise<string | null> {
  const store = await cookies()
  const raw = store.get(CHALLENGE_COOKIE)?.value
  store.delete(CHALLENGE_COOKIE)
  if (!raw) return null
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8')
    const [user, expiry, challenge, sig] = decoded.split('.')
    if (!user || !expiry || !challenge || !sig) return null
    if (user !== username) return null
    if (Date.now() > Number(expiry)) return null
    const expected = sign(`${user}.${expiry}.${challenge}`)
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    return challenge
  } catch {
    return null
  }
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
