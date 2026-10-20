import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentAdmin } from '@/lib/auth'
import { getI18n } from '@/lib/i18n/server'
import type { MessageKey } from '@/lib/i18n/types'

export const dynamic = 'force-dynamic'

type Endpoint = { method: string; path: string; desc: MessageKey; sample?: MessageKey }

const GROUPS: Array<{ key: string; title: MessageKey; note?: MessageKey; endpoints: Endpoint[] }> = [
  {
    key: 'domains',
    title: 'apiDocs.groupDomains',
    endpoints: [
      { method: 'GET', path: '/api/v1/domains', desc: 'apiDocs.domainsList' },
      {
        method: 'POST',
        path: '/api/v1/domains',
        desc: 'apiDocs.domainsCreate',
        sample: 'apiDocs.sampleDomainsCreate',
      },
      { method: 'GET', path: '/api/v1/domains/{id}', desc: 'apiDocs.domainsDetail' },
      { method: 'PATCH', path: '/api/v1/domains/{id}', desc: 'apiDocs.domainsUpdate' },
      { method: 'DELETE', path: '/api/v1/domains/{id}', desc: 'apiDocs.domainsDelete' },
    ],
  },
  {
    key: 'mailboxes',
    title: 'apiDocs.groupMailboxes',
    endpoints: [
      { method: 'GET', path: '/api/v1/domains/{id}/mailboxes', desc: 'apiDocs.mailboxesList' },
      {
        method: 'POST',
        path: '/api/v1/domains/{id}/mailboxes',
        desc: 'apiDocs.mailboxesCreate',
      },
      { method: 'PATCH', path: '/api/v1/mailboxes/{id}', desc: 'apiDocs.mailboxesUpdate' },
      { method: 'DELETE', path: '/api/v1/mailboxes/{id}', desc: 'apiDocs.mailboxesDelete' },
    ],
  },
  {
    key: 'rules',
    title: 'apiDocs.groupRules',
    endpoints: [
      { method: 'GET', path: '/api/v1/domains/{id}/rules', desc: 'apiDocs.rulesList' },
      {
        method: 'POST',
        path: '/api/v1/domains/{id}/rules',
        desc: 'apiDocs.rulesCreate',
        sample: 'apiDocs.sampleRulesCreate',
      },
      { method: 'PATCH', path: '/api/v1/rules/{id}', desc: 'apiDocs.rulesUpdate' },
      { method: 'DELETE', path: '/api/v1/rules/{id}', desc: 'apiDocs.rulesDelete' },
    ],
  },
  {
    key: 'dns',
    title: 'apiDocs.groupDns',
    endpoints: [
      { method: 'GET', path: '/api/v1/domains/{id}/dns', desc: 'apiDocs.dnsList' },
      { method: 'POST', path: '/api/v1/domains/{id}/dns', desc: 'apiDocs.dnsGenerate' },
      {
        method: 'POST',
        path: '/api/v1/domains/{id}/dns/push',
        desc: 'apiDocs.dnsPush',
        sample: 'apiDocs.sampleDnsPush',
      },
      { method: 'POST', path: '/api/v1/domains/{id}/dns/check', desc: 'apiDocs.dnsCheck' },
      { method: 'GET', path: '/api/v1/domains/{id}/dns/export?format=bind|text', desc: 'apiDocs.dnsExport' },
      { method: 'GET', path: '/api/v1/dns/preview?domain=example.com', desc: 'apiDocs.dnsPreview' },
    ],
  },
  {
    key: 'monitor',
    title: 'apiDocs.groupMonitor',
    endpoints: [
      { method: 'GET', path: '/api/v1/system/spam-stats', desc: 'apiDocs.spamStats' },
      { method: 'GET', path: '/api/v1/system/queue?lines=200', desc: 'apiDocs.queueStatus' },
      { method: 'GET', path: '/api/v1/system/deliverability', desc: 'apiDocs.deliverability' },
      {
        method: 'POST',
        path: '/api/v1/system/reconcile',
        desc: 'apiDocs.reconcile',
        sample: 'apiDocs.sampleReconcile',
      },
      { method: 'GET', path: '/api/v1/system/backup?what=db|dms-config', desc: 'apiDocs.backup' },
      { method: 'GET', path: '/api/v1/system/tokens', desc: 'apiDocs.tokensList' },
      { method: 'POST', path: '/api/v1/system/tokens', desc: 'apiDocs.tokensCreate' },
      { method: 'DELETE', path: '/api/v1/system/tokens?id=1', desc: 'apiDocs.tokensRevoke' },
    ],
  },
  {
    key: 'cloudflare',
    title: 'apiDocs.groupCloudflare',
    endpoints: [
      { method: 'GET', path: '/api/v1/cloudflare/zones', desc: 'apiDocs.cfZones' },
      {
        method: 'POST',
        path: '/api/v1/cloudflare/import',
        desc: 'apiDocs.cfImport',
        sample: 'apiDocs.sampleCfImport',
      },
      { method: 'POST', path: '/api/v1/cloudflare/push-all', desc: 'apiDocs.cfPushAll' },
    ],
  },
  {
    key: 'settings',
    title: 'apiDocs.groupSettings',
    endpoints: [
      { method: 'GET', path: '/api/v1/settings', desc: 'apiDocs.settingsGet' },
      { method: 'PATCH', path: '/api/v1/settings', desc: 'apiDocs.settingsUpdate' },
      { method: 'POST', path: '/api/v1/settings', desc: 'apiDocs.settingsCheck' },
      { method: 'DELETE', path: '/api/v1/settings', desc: 'apiDocs.settingsDelete' },
      { method: 'GET', path: '/api/health', desc: 'apiDocs.health' },
    ],
  },
]

export default async function ApiDocsPage() {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')
  const { t } = await getI18n()

  return (
    <main className="wrap">
      <div className="topbar">
        <span className="logo">🍀</span>
        <h1>{t('apiDocs.title')}</h1>
        <span className="tag">{t('apiDocs.tagline')}</span>
      </div>

      <section className="panel">
        <h2>{t('apiDocs.authTitle')}</h2>
        <p className="hint">
          {t('apiDocs.authLead')} <span className="mono">/api/v1/*</span> {t('apiDocs.authBody')}
          <span className="mono"> Authorization: Bearer clover_…</span>{t('apiDocs.authBodyAfterToken')}
        </p>
        <p className="hint">
          {t('apiDocs.errorFormatLead')} <span className="mono">{t('apiDocs.errorFormatSample')}</span>{t('apiDocs.errorFormatBody')} <span className="mono">{t('apiDocs.auditActor')}</span>{t('apiDocs.errorFormatEnd')}
        </p>
      </section>

      {GROUPS.map((g) => (
        <section className="panel" key={g.key}>
          <h2>{t(g.title)}</h2>
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 70 }}>{t('apiDocs.colMethod')}</th>
                <th>{t('apiDocs.colPath')}</th>
                <th>{t('apiDocs.colDescription')}</th>
              </tr>
            </thead>
            <tbody>
              {g.endpoints.map((e) => (
                <tr key={e.method + e.path}>
                  <td>
                    <span
                      className={
                        'tag ' +
                        (e.method === 'GET' ? 'ok' : e.method === 'DELETE' ? 'err' : 'warn')
                      }
                    >
                      {e.method}
                    </span>
                  </td>
                  <td className="mono">{e.path}</td>
                  <td className="hint-text">{t(e.desc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.endpoints.some((e) => e.sample) && (
            <pre className="services">
              {g.endpoints
                .filter((e): e is Endpoint & { sample: MessageKey } => Boolean(e.sample))
                .map((e) => `# ${t(e.desc)}\n${t(e.sample)}`)
                .join('\n\n')}
            </pre>
          )}
        </section>
      ))}

      <p className="hint">
        <Link href="/settings">{t('apiDocs.goGenerateToken')}</Link>
      </p>
    </main>
  )
}
