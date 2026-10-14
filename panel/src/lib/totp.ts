import { Secret, TOTP } from 'otpauth'
import QRCode from 'qrcode'

const ISSUER = 'clover 三叶草邮局'
/** 允许前后 1 个 30s 时间窗（时钟漂移容错） */
const WINDOW = 1

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

function build(userLabel: string, secretBase32: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label: userLabel,
    secret: Secret.fromBase32(secretBase32),
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  })
}

export function totpUri(username: string, secretBase32: string): string {
  return build(username, secretBase32).toString()
}

export async function totpQrDataUrl(username: string, secretBase32: string): Promise<string> {
  return QRCode.toDataURL(totpUri(username, secretBase32), { margin: 1, width: 220 })
}

/** 校验一次性码（返回 null = 不通过，返回 delta = 命中的偏移窗口，防重放可记录 lastUsedDelta） */
export function verifyTotp(username: string, secretBase32: string, code: string): boolean {
  const cleaned = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(cleaned)) return false
  const delta = build(username, secretBase32).validate({ token: cleaned, window: WINDOW })
  return delta !== null
}

export function currentTotp(username: string, secretBase32: string): string {
  return build(username, secretBase32).generate()
}
