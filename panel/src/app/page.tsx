import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentAdmin } from '@/lib/auth'
import { desc, sql } from 'drizzle-orm'
import { db } from '@/db'
import { auditLogs, dnsRecords, domains, mailboxes, routingRules } from '@/db/schema'
import { supervisorStatus } from '@/lib/dms'
import { DATE_LOCALE } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import type { Translator } from '@/lib/i18n/translate'
import type { MessageKey } from '@/lib/i18n/types'

export const dynamic = 'force-dynamic'

const count = async (table: Parameters<typeof db.select>[0] extends never ? never : any): Promise<number> => {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(table)
  return Number(row.n)
}

const ACTION_LABELS: Record<string, MessageKey> = {
  'domain.create': 'dashboard.actionDomainCreate',
  'domain.delete': 'dashboard.actionDomainDelete',
  'mailbox.create': 'dashboard.actionMailboxCreate',
  'mailbox.delete': 'dashboard.actionMailboxDelete',
  'rule.create': 'dashboard.actionRuleCreate',
  'rule.delete': 'dashboard.actionRuleDelete',
  'dns.generate': 'dashboard.actionDnsGenerate',
  'dns.push': 'dashboard.actionDnsPush',
  'dns.check': 'dashboard.actionDnsCheck',
  'roundcube.open': 'dashboard.actionRoundcubeOpen',
  'settings.update': 'dashboard.actionSettingsUpdate',
  'auth.login': 'dashboard.actionAuthLogin',
  'system.reconcile': 'dashboard.actionSystemReconcile',
  'seed': 'dashboard.actionSeed',
}

function label(action: string, t: Translator): string {
  const key = ACTION_LABELS[action]
  return key ? t(key) : action
}

export default async function Dashboard() {
  if (!await getCurrentAdmin()) redirect('/login')
  const { t, locale } = await getI18n()
  const [domainCount, mailboxCount, ruleCount, dnsCount, dnsPushed, logCount, dms, recentLogs, domainRows] =
    await Promise.all([
      count(domains),
      count(mailboxes),
      count(routingRules),
      count(dnsRecords),
      db
        .select({ n: sql<number>`count(*)` })
        .from(dnsRecords)
        .where(sql`${dnsRecords.status} = 'pushed'`)
        .then((r) => Number(r[0]?.n ?? 0)),
      count(auditLogs),
      supervisorStatus().then((r) =>
        r.ok ? { state: 'up' as const, detail: r.stdout } : { state: 'down' as const, detail: r.error.slice(0, 200) },
      ),
      db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(8),
      db.select({ id: domains.id, name: domains.name }).from(domains).orderBy(desc(domains.id)).limit(3),
    ])

  const stats: Array<{ id: string; label: MessageKey; value: number; unit: MessageKey }> = [
    { id: 'domains', label: 'dashboard.statDomains', value: domainCount, unit: 'dashboard.unitCount' },
    { id: 'mailboxes', label: 'dashboard.statMailboxes', value: mailboxCount, unit: 'dashboard.unitCount' },
    { id: 'rules', label: 'dashboard.statRules', value: ruleCount, unit: 'dashboard.unitItem' },
    { id: 'dns', label: 'dashboard.statDns', value: dnsCount, unit: 'dashboard.unitItem' },
    { id: 'pushed', label: 'dashboard.statPushed', value: dnsPushed, unit: 'dashboard.unitItem' },
    { id: 'logs', label: 'dashboard.statLogs', value: logCount, unit: 'dashboard.unitItem' },
  ]

  return (
    <main className="wrap dashboard-page">
      <header className="dashboard-heading">
        <div>
          <p className="dashboard-eyebrow">CLOVER MAIL · OVERVIEW</p>
          <h1>{t('dashboard.title')}</h1>
          <p className="dashboard-intro">{t('dashboard.intro')}</p>
        </div>
        <Link className="dashboard-secondary" href="/domains">{t('dashboard.addDomain')}</Link>
      </header>

      <section className="dashboard-primary" aria-labelledby="cloudflare-title">
        <div className="dashboard-primary-copy">
          <span className="dashboard-kicker"><span className="status-dot" /> DNS · CLOUDFLARE</span>
          <h2 id="cloudflare-title">{t('dashboard.cloudflareTitle')}</h2>
          <p>{t('dashboard.cloudflareBody')}</p>
        </div>
        <Link className="dashboard-primary-link" href="/cloudflare">{t('dashboard.cloudflareLink')} <span aria-hidden="true">→</span></Link>
      </section>

      <section className="dashboard-stats" aria-label={t('dashboard.statsLabel')}>
        {stats.map((s) => (
          <div className="dashboard-stat" key={s.id}>
            <div className="dashboard-stat-label">{t(s.label)}</div>
            <div className={'dashboard-stat-value' + (s.value === 0 ? ' is-zero' : '')}>{s.value}<span>{t(s.unit)}</span></div>
          </div>
        ))}
      </section>

      <section className="panel dashboard-service">
        <div className="section-title"><h2>{t('dashboard.mailServiceTitle')}</h2><span className={'tag ' + (dms.state === 'up' ? 'ok' : 'err')}>
          {dms.state === 'up' ? t('dashboard.mailServiceUp') : t('dashboard.mailServiceDown')}
        </span></div>
        <p className="hint">{t('dashboard.mailServiceHint')}</p>
        {dms.state === 'up' && <pre className="services">{dms.detail}</pre>}
      </section>

      <div className="dashboard-lower">
        <section className="panel dashboard-domains">
          <div className="section-title"><h2>{t('dashboard.recentDomains')}</h2><Link href="/domains" className="dashboard-text-link">{t('dashboard.viewAll')}</Link></div>
          {domainRows.length > 0 ? <ul className="dashboard-domain-list">
            {domainRows.map((d) => <li key={d.id}><span className="mono">{d.name}</span><Link className="dashboard-text-link" href={`/environment?domain=${d.id}#domain-dns`}>{t('dashboard.dnsSettings')}</Link></li>)}
          </ul> : <p className="empty">{t('dashboard.noDomains')}</p>}
        </section>

        <section className="panel dashboard-activity">
          <div className="section-title"><h2>{t('dashboard.recentActivity')}</h2><span className="count">{t('dashboard.activityCount', { count: recentLogs.length })}</span></div>
          {recentLogs.length > 0 ? (
            <div className="table-scroll"><table className="grid">
              <thead><tr><th>{t('common.time')}</th><th>{t('common.actions')}</th><th>{t('dashboard.colTarget')}</th><th>{t('dashboard.colActor')}</th></tr></thead>
              <tbody>{recentLogs.map((l) => <tr key={l.id}><td className="hint-text">{new Date(l.createdAt).toLocaleString(DATE_LOCALE[locale])}</td><td>{label(l.action, t)}</td><td className="mono">{l.target ?? '—'}</td><td className="hint-text">{l.actor}</td></tr>)}</tbody>
            </table></div>
          ) : <p className="empty">{t('dashboard.noActivity')}</p>}
        </section>
      </div>
    </main>
  )
}
