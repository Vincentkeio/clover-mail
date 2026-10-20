import { asc, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { domains, mailboxes, routingRules } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'
import { getI18n } from '@/lib/i18n/server'
import { getMailHostname } from '@/lib/settings'
import DomainCreateForm from '../environment/domain-create-form'
import DomainListControls from './domain-list-controls'

export const dynamic = 'force-dynamic'

export default async function DomainsPage() {
  const { t } = await getI18n()
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')

  const [rows, mbCounts, ruCounts] = await Promise.all([
    db.select().from(domains).orderBy(asc(domains.id)),
    db.select({ domainId: mailboxes.domainId, n: sql<number>`count(*)` }).from(mailboxes).groupBy(mailboxes.domainId),
    db.select({ domainId: routingRules.domainId, n: sql<number>`count(*)` }).from(routingRules).groupBy(routingRules.domainId),
  ])
  const mbMap = new Map(mbCounts.map((row) => [row.domainId, Number(row.n)]))
  const ruMap = new Map(ruCounts.map((row) => [row.domainId, Number(row.n)]))

  return <main className="wrap">
    <div className="topbar"><div><p className="eyebrow">SETUP / 02</p><h1>{t('domains.title')}</h1><p className="hint">{t('domains.intro')}</p></div><span className="tag">{t('domains.countHint', { count: rows.length })}</span></div>
    <section className="panel">
      <h2>{t('domains.addTitle')}</h2>
      <p className="hint">{t('domains.addHint')}</p>
      <DomainCreateForm />
    </section>
    <section className="panel">
      {rows.length === 0 ? <p className="empty">{t('domains.empty')}</p> : <div className="table-scroll"><table className="grid domain-list-table">
        <thead><tr><th>{t('common.domain')}</th><th>{t('domains.colMailHostname')}</th><th>{t('domains.colMailboxes')}</th><th>{t('domains.colRules')}</th><th>{t('domains.colOwnership')}</th><th>{t('common.status')}</th><th>{t('common.actions')}</th></tr></thead>
        <tbody>{rows.map((domain) => <tr key={domain.id}>
          <td><span className="mono">{domain.name}</span></td>
          <td className="mono">{getMailHostname(domain.mailHostname || `mail.${domain.name}`)}</td>
          <td>{mbMap.get(domain.id) ?? 0}</td>
          <td>{ruMap.get(domain.id) ?? 0}</td>
          <td className="mono">{domain.ownershipToken}</td>
          <DomainListControls id={domain.id} name={domain.name} active={domain.active} mailboxCount={mbMap.get(domain.id) ?? 0} ruleCount={ruMap.get(domain.id) ?? 0} />
        </tr>)}</tbody>
      </table></div>}
    </section>
  </main>
}
