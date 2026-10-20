import { Secret, TOTP } from 'otpauth'
import QRCode from 'qrcode'
import { DEFAULT_LOCALE } from './i18n/config'
import { createTranslator, type Translator } from './i18n/translate'

/** 调用方未传 Translator 时的兜底（默认语言），避免漏改调用点时丢文案。 */
const fallbackTranslator = createTranslator(DEFAULT_LOCALE)

/** issuer 只影响认证器应用里的显示名，校验结果与它无关。 */
const DEFAULT_ISSUER = fallbackTranslator('common.appTitle')
/** 允许前后 1 个 30s 时间窗（时钟漂移容错） */
const WINDOW = 1

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

function build(userLabel: string, secretBase32: string, issuer = DEFAULT_ISSUER): TOTP {
  return new TOTP({
    issuer,
    label: userLabel,
    secret: Secret.fromBase32(secretBase32),
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  })
}

export function totpUri(username: string, secretBase32: string, t: Translator = fallbackTranslator): string {
  return build(username, secretBase32, t('common.appTitle')).toString()
}

export async function totpQrDataUrl(username: string, secretBase32: string, t: Translator = fallbackTranslator): Promise<string> {
  return QRCode.toDataURL(totpUri(username, secretBase32, t), { margin: 1, width: 220 })
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
