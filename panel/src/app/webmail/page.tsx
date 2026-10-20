import { redirect } from 'next/navigation'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'
import { getI18n } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'
export default async function WebmailPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { t } = await getI18n()
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')
  const { error } = await searchParams
  const boxes = await db.select({ login: mailboxes.login }).from(mailboxes)
    .innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(and(eq(mailboxes.active, true), eq(domains.active, true))).orderBy(asc(mailboxes.id))
  return <main className="wrap"><div className="topbar"><div><p className="eyebrow">MAIL</p><h1>Roundcube Webmail</h1><p className="hint">{t('webmail.intro')}</p></div></div>
    {error === 'sso' && <p className="msg err" role="alert">{t('webmail.ssoFailed')}</p>}
    <section className="panel"><h2>{t('webmail.openTitle')}</h2>{boxes.length ? <form action="/api/v1/roundcube/sso" method="post" target="_blank" rel="noopener" className="form-row"><div className="field"><label htmlFor="roundcube-login">{t('webmail.mailboxLabel')}</label><select id="roundcube-login" name="login">{boxes.map((box) => <option key={box.login} value={box.login}>{box.login}</option>)}</select></div><button type="submit" className="primary">{t('webmail.openRoundcube')}</button></form> : <p className="empty">{t('webmail.empty')}</p>}</section>
  </main>
}
