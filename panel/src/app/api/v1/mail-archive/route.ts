import { NextResponse } from 'next/server'
import { asc } from 'drizzle-orm'
import { db } from '@/db'
import { mailboxes } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!await getCurrentAdmin()) return unauthorized()
  const rows = await db.select({ id: mailboxes.id, login: mailboxes.login, active: mailboxes.active }).from(mailboxes).orderBy(asc(mailboxes.login))
  return NextResponse.json(rows)
}
