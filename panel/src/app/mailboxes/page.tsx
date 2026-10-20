import { redirect } from 'next/navigation'
import { asc } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'
import MailboxManager from './mailbox-manager'

export const dynamic = 'force-dynamic'

export default async function MailboxesPage() {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')
  const [domainRows, mailboxRows] = await Promise.all([
    db.select().from(domains).orderBy(asc(domains.name)),
    db.select().from(mailboxes).orderBy(asc(mailboxes.login)),
  ])
  return <MailboxManager mailHost={process.env.MAIL_HOSTNAME || process.env.MAIL_FQDN || ''} domains={domainRows.map((domain) => ({ id: domain.id, name: domain.name, active: domain.active }))}
    mailboxes={mailboxRows.map((box) => ({ id: box.id, domainId: box.domainId, login: box.login, active: box.active, quotaMb: box.quotaMb }))} />
}
