import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { pushDomainDns } from '@/lib/cf-sync'
import { getCfToken } from '@/lib/settings'
import { getTranslator } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const t = await getTranslator()
  const id = Number((await ctx.params).id)
  const [domain] = await db.select().from(domains).where(eq(domains.id, id)).limit(1)
  if (!domain) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const token = await getCfToken()
  if (!token) {
    return NextResponse.json(
      { error: t('apiErrors.push.cfTokenMissing'), pushed: false },
      { status: 400 },
    )
  }

  const result = await pushDomainDns({
    id: domain.id,
    name: domain.name,
    mailHostname: domain.mailHostname,
    ownershipToken: domain.ownershipToken,
  }, token, t)
  if (!result.ok) {
    await audit(admin.username, 'dns.push', domain.name, { failed: result.error })
    return NextResponse.json({ ...result, pushed: false }, { status: 502 })
  }

  await audit(admin.username, 'dns.push', domain.name, {
    zoneId: result.zoneId,
    noop: result.noop,
    posted: result.posted,
    patched: result.patched,
    deleted: result.deleted,
  })
  return NextResponse.json({ ...result, pushed: true })
}
