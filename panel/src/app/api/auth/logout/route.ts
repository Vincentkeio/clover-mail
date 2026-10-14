import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { sessionCookie } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST() {
  const store = await cookies()
  store.delete(sessionCookie.name)
  return NextResponse.json({ ok: true })
}
