import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * settings 表里的敏感值加密（CF token 等）。
 * AES-256-GCM，key 由 SESSION_SECRET 经 scrypt 派生（服务端不进库）。
 * 格式：base64( iv(12) || tag(16) || ciphertext )
 */
const ALGO = 'aes-256-gcm'
const SALT = 'clover-settings-v1'

function deriveKey(): Buffer {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET 未设置或过短（≥16 字符），无法加解密敏感设置')
  }
  return scryptSync(secret, SALT, 32)
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, deriveKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ct = raw.subarray(28)
  const decipher = createDecipheriv(ALGO, deriveKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** 脱敏展示：只留前 6 位 */
export function maskSecret(value: string): string {
  if (value.length <= 6) return '***'
  return `${value.slice(0, 6)}…${'*'.repeat(8)}`
}
