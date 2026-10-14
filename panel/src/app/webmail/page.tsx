import { redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'
import { getGlobalMailSettings } from '@/lib/settings'
import Webmail from './webmail'

export const dynamic = 'force-dynamic'

export default async function WebmailPage() {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')
  const [boxes, mailSettings] = await Promise.all([
    db.select({ login: mailboxes.login, active: mailboxes.active })
      .from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)).orderBy(asc(mailboxes.id)),
    getGlobalMailSettings(),
  ])
  return <main className="wrap webmail-page"><Webmail mailboxes={boxes.filter((box) => box.active)} maxAttachmentMb={mailSettings.maxAttachmentMb} /></main>
}
