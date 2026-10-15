import { NextResponse } from 'next/server'
import { asc, sql } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes, routingRules } from '@/db/schema'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { createDomainSchema, newOwnershipToken } from '@/lib/validators'
import { syncDomainCreate } from '@/lib/sync'
import { syncSrsDomains } from '@/lib/srs-sync'

export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const domainRows = await db.select().from(domains).orderBy(asc(domains.id))
  const mailboxCounts = await db
    .select({ domainId: mailboxes.domainId, n: sql<number>`count(*)` })
    .from(mailboxes)
    .groupBy(mailboxes.domainId)
  const ruleCounts = await db
    .select({ domainId: routingRules.domainId, n: sql<number>`count(*)` })
    .from(routingRules)
    .groupBy(routingRules.domainId)

  const mbMap = new Map(mailboxCounts.map((r) => [r.domainId, Number(r.n)]))
  const ruMap = new Map(ruleCounts.map((r) => [r.domainId, Number(r.n)]))

  return NextResponse.json(
    domainRows.map((d) => ({ ...d, mailboxCount: mbMap.get(d.id) ?? 0, ruleCount: ruMap.get(d.id) ?? 0 })),
  )
}

export async function POST(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const parsed = createDomainSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten() }, { status: 400 })
  }
  const { name, mailHostname, quotaPolicyMb } = parsed.data

  try {
    const [row] = await db
      .insert(domains)
      .values({
        name,
        ownershipToken: newOwnershipToken(),
        mailHostname: mailHostname ?? `mail.${name}`,
        quotaPolicyMb: quotaPolicyMb ?? null,
      })
      .returning()

    const sync = await syncDomainCreate(name)
    const srs = await syncSrsDomains()
    await audit(admin.username, 'domain.create', name, { id: row.id, dmsSynced: sync.ok && srs.ok })
    return NextResponse.json({ ...row, dmsSynced: sync.ok && srs.ok }, { status: 201 })
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return NextResponse.json({ error: '域名已存在' }, { status: 409 })
    }
    throw err
  }
}
