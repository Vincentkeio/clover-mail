import { NextResponse } from 'next/server'
import { db } from '@/db'
import { domains, mailboxes } from '@/db/schema'
import { sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

/** 健康检查：DB 可用即 200；compose healthcheck 也打这个端点 */
export async function GET() {
  try {
    const [d] = await db.select({ n: sql<number>`count(*)` }).from(domains)
    const [m] = await db.select({ n: sql<number>`count(*)` }).from(mailboxes)
    return NextResponse.json({
      ok: true,
      db: 'up',
      domains: Number(d.n),
      mailboxes: Number(m.n),
      time: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json({ ok: false, db: 'down', error: String(err) }, { status: 503 })
  }
}
