import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { sessionCookie, verifySessionToken } from './session'
import { TOKEN_PREFIX, verifyApiToken } from './api-token'
import { isDemoMode } from './runtime-mode'
import { hasTrustedOrigin } from './request-origin'

export type CurrentAdmin = { id: number; username: string }

/**
 * 当前调用者；未认证返回 null。
 * 三种来源（按优先级）：
 * 1. DEMO_MODE 虚拟管理员（仅本地预览）
 * 2. Authorization: Bearer clover_… 开放 API token（审计里记为 api:<name>）
 * 3. 面板 session cookie
 */
export async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  if (isDemoMode()) return { id: 0, username: 'demo' }

  const h = await headers()
  const authz = h.get('authorization')
  if (authz?.startsWith('Bearer ')) {
    const raw = authz.slice(7).trim()
    if (raw.startsWith(TOKEN_PREFIX)) {
      const token = await verifyApiToken(raw)
      if (token) return { id: 0, username: `api:${token.name}` }
      return null
    }
  }

  // SameSite cookies also travel between sibling subdomains. Validate browser
  // origins before accepting cookie authentication, including upload handlers.
  if (!hasTrustedOrigin(h)) return null
  const store = await cookies()
  const token = store.get(sessionCookie.name)?.value
  const adminId = verifySessionToken(token)
  if (!adminId) return null
  const [row] = await db
    .select({ id: admins.id, username: admins.username, passwordHash: admins.passwordHash })
    .from(admins)
    .where(eq(admins.id, adminId))
    .limit(1)
  if (!row || !verifySessionToken(token, row.passwordHash)) return null
  return { id: row.id, username: row.username }
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export async function hasAnyAdmin(): Promise<boolean> {
  const rows = await db.select({ id: admins.id }).from(admins).limit(1)
  return rows.length > 0
}
