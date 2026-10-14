import { hash, verify } from '@node-rs/argon2'

/** argon2id，OWASP 建议参数（19 MiB / t=2 / p=1） */
const OPTS = {
  algorithm: 2 as const, // Argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
}

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS)
}

export function verifyPassword(stored: string, plain: string): Promise<boolean> {
  return verify(stored, plain)
}
