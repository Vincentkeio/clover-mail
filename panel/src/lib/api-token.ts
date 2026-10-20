import { createHash, randomBytes } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { apiTokens } from '@/db/schema'

/** 开放 API token 前缀（便于审计/日志识别与泄露扫描） */
export const TOKEN_PREFIX = 'clover_'

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 创建 token：明文只在此刻返回一次，库里只存 sha256 */
export async function createApiToken(name: string): Promise<{ id: number; token: string; prefix: string }> {
  const token = TOKEN_PREFIX + randomBytes(24).toString('base64url')
  const [row] = await db
    .insert(apiTokens)
    .values({ name, tokenHash: hashApiToken(token), prefix: `${token.slice(0, 14)}…` })
    .returning()
  return { id: row.id, token, prefix: row.prefix }
}

export async function verifyApiToken(token: string): Promise<{ id: number; name: string } | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashApiToken(token)))
    .limit(1)
  if (!row || row.revokedAt) return null
  await db.update(apiTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiTokens.id, row.id))
  return { id: row.id, name: row.name }
}

export async function listApiTokens() {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .orderBy(desc(apiTokens.id))
}

export async function revokeApiToken(id: number): Promise<boolean> {
  const rows = await db
    .update(apiTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(apiTokens.id, id))
    .returning()
  return rows.length > 0
}
