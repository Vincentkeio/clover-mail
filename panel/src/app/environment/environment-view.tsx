'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'
import type { MessageKey } from '@/lib/i18n/types'
import { checkItemLabel } from '@/components/check-item-label'
import DnsPanel from './domain-dns-panel'

type Step = { key: string; label: string; ok: boolean; detail: string; href: string; action: string; repair?: boolean }
type Domain = { id: number; name: string; active: boolean; checkedAt: string | null; items: Array<{ key: string; label: string; ok: boolean }>; mailHostname: string; ownershipToken: string; mailboxCount: number; ruleCount: number }
type Environment = { checkedAt: string; steps: Step[]; domains: Domain[]; panelHost: string; mailHost: string; dnsMode: string }

const DNS_TABS: Array<{ id: 'automatic' | 'advanced' | 'manual'; label: MessageKey }> = [
  { id: 'automatic', label: 'environment.tabAutomatic' },
  { id: 'advanced', label: 'environment.advancedTitle' },
  { id: 'manual', label: 'environment.manualTitle' },
]

export default function EnvironmentView({ mode, manageDomains = false, initialDomainId }: { mode: 'setup' | 'check'; manageDomains?: boolean; initialDomainId?: number }) {
  const { t, dateLocale } = useI18n()
  const [data, setData] = useState<Environment | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [checkingDomain, setCheckingDomain] = useState<number | null>(null)
  const [dnsDomainsExpanded, setDnsDomainsExpanded] = useState(false)
  const [selectedDomainId, setSelectedDomainId] = useState<number | null>(initialDomainId ?? null)
  const [dnsTab, setDnsTab] = useState<'automatic' | 'advanced' | 'manual'>('automatic')
  const [repairing, setRepairing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/system/environment', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || t('environment.loadStatusFailed'))
      setData(body)
      setSelectedDomainId((current) => current && body.domains.some((domain: Domain) => domain.id === current)
        ? current
        : initialDomainId && body.domains.some((domain: Domain) => domain.id === initialDomainId)
          ? initialDomainId
          : body.domains[0]?.id ?? null)
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : t('common.loadFailed')) }
    finally { setLoading(false) }
  }, [initialDomainId, t])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (initialDomainId) setSelectedDomainId(initialDomainId) }, [initialDomainId])

  async function recheck() {
    setChecking(true)
    setError('')
    try {
      const res = await fetch('/api/v1/system/environment', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || t('environment.dnsCheckFailed'))
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : t('environment.checkFailed')) }
    finally { setChecking(false) }
  }

  async function recheckDomain(id: number) {
    setCheckingDomain(id)
    setError('')
    try {
      const res = await fetch(`/api/v1/domains/${id}/dns/check`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || t('environment.dnsCheckFailed'))
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : t('environment.checkFailed')) }
    finally { setCheckingDomain(null) }
  }

  function selectDomain(id: number) { setSelectedDomainId(id) }

  async function repairMailService() {
    setRepairing(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch('/api/v1/system/environment/mail-service/repair', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || t('environment.repairFailed'))
      setNotice(body.message || t('environment.repairSuccess'))
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : t('environment.repairFailed')) }
    finally { setRepairing(false) }
  }

  const setup = mode === 'setup'
  const steps = setup ? data?.steps.filter((step) => ['cloudflare', 'domains', 'dns', 'panel-tls', 'mail-tls', 'mail-rdns'].includes(step.key)) : data?.steps
  const allGood = Boolean(steps?.length && steps.every((step) => step.ok))
  return <main className="wrap environment-page">
    <div className="topbar environment-heading"><div><p className="eyebrow">{manageDomains ? 'SYSTEM / DNS' : setup ? 'SETUP / 03' : 'SYSTEM / CHECK'}</p><h1>{manageDomains ? t('environment.titleDns') : setup ? t('environment.titleSetup') : t('environment.titleCheck')}</h1>
      <p className="hint">{manageDomains ? t('environment.hintDns') : setup ? t('environment.hintSetup') : t('environment.hintCheck')}</p></div>
      {!manageDomains && <button type="button" onClick={() => void recheck()} disabled={checking || loading}>{checking ? t('environment.checking') : t('environment.recheck')}</button>}</div>
    {error && <div className="banner" role="alert">{error}</div>}
    {notice && <div className="msg ok" role="status">{notice}</div>}
    {loading && !data ? <p className="hint">{t('environment.loadingHint')}</p> : <>
      {!manageDomains && <section className={`environment-summary ${allGood ? 'is-ok' : 'is-error'}`}>
        <span className="environment-summary-symbol" aria-hidden="true">{allGood ? '✓' : '!'}</span>
        <div><strong>{allGood ? (setup ? t('environment.setupComplete') : t('environment.checkPassed')) : t('environment.itemsNeedAttention', { count: steps?.filter((step) => !step.ok).length ?? 0 })}</strong><p>{allGood ? (setup ? t('environment.setupReadyDesc') : t('environment.checkReadyDesc')) : t('environment.fixHint')}</p></div>
        {allGood && <Link className="primary environment-next" href="/mailboxes">{t('environment.createMailbox')}</Link>}
      </section>}
      {!manageDomains && <div className="environment-steps">{steps?.map((step, index) => {
        const failedDnsDomains = step.key === 'dns' ? (data?.domains ?? []).filter((domain) => domain.active && (!domain.items.length || domain.items.some((item) => !item.ok))) : []
        const detailId = 'environment-dns-domain-details'
        return <Fragment key={step.key}>
          <section className="environment-step">
            <div className="environment-step-index">{String(index + 1).padStart(2, '0')}</div><div className="environment-step-body"><div className="environment-step-title"><h2>{step.label}</h2><span className={`tag ${step.ok ? 'ok' : 'err'}`}>{step.ok ? t('environment.stepOk') : t('environment.stepPending')}</span></div>
              <p>{step.detail}</p></div><div className="environment-step-actions">{failedDnsDomains.length > 0 && <button type="button" className="environment-dns-toggle" aria-expanded={dnsDomainsExpanded} aria-controls={detailId} onClick={() => setDnsDomainsExpanded((expanded) => !expanded)}>{dnsDomainsExpanded ? t('environment.hideDomains') : t('environment.showDomains')} <span aria-hidden="true">{dnsDomainsExpanded ? '⌃' : '⌄'}</span></button>}{step.repair && <button type="button" className="primary" disabled={repairing} onClick={() => void repairMailService()}>{repairing ? t('environment.repairing') : t('environment.repairMailService')}</button>}<Link className="btn-link" href={step.href}>{step.action} →</Link></div>
          </section>
          {failedDnsDomains.length > 0 && <div className="environment-dns-details" id={detailId} hidden={!dnsDomainsExpanded}>
            <div className="environment-dns-details-heading">{t('environment.failedDomainsTitle')}</div>
            {failedDnsDomains.map((domain) => {
              const failedItems = domain.items.filter((item) => !item.ok)
              return <div className="environment-dns-domain" key={domain.id}>
                <div><b className="mono">{domain.name}</b><p>{failedItems.length ? t('environment.failedItems', { items: failedItems.map((item) => checkItemLabel(item, t)).join(t('environment.listSeparator')) }) : t('environment.dnsNotCompleted')}</p></div>
                <Link className="btn-link" href={`/environment?domain=${domain.id}#domain-dns`}>{t('environment.manageDns')}</Link>
              </div>
            })}
          </div>}
        </Fragment>
      })}</div>}
      {manageDomains ? <div className="dns-management-layout" id="domain-manager">
        <nav className="dns-tabs" role="tablist" aria-label={t('environment.dnsTabsAria')}>
          {DNS_TABS.map((tab) => <button key={tab.id} type="button" role="tab" id={`dns-tab-${tab.id}`} aria-selected={dnsTab === tab.id} aria-controls={`dns-panel-${tab.id}`} className={dnsTab === tab.id ? 'is-active' : ''} style={dnsTab === tab.id ? { background: '#087b59', borderColor: '#087b59', color: '#fff' } : undefined} onClick={() => setDnsTab(tab.id)}>{t(tab.label)}</button>)}
        </nav>
        <section className="dns-tab-panel" role="tabpanel" id={`dns-panel-${dnsTab}`} aria-labelledby={`dns-tab-${dnsTab}`}>
          {dnsTab === 'automatic' && <div className="dns-auto-domain-list" aria-label={t('environment.autoListAria')}>
            {data?.domains.map((domain) => {
              const passed = domain.items.filter((item) => item.ok).length
              const total = domain.items.length
              return <article className="dns-auto-domain-card" key={domain.id}>
                <header className="dns-auto-domain-header">
                  <div><div className="dns-auto-domain-title"><h2 className="mono">{domain.name}</h2><span className={`dns-domain-state ${domain.active ? 'is-active' : ''}`}>{domain.active ? t('common.active') : t('common.inactive')}</span></div>
                    <p>{t('environment.domainSummary', { mailboxes: domain.mailboxCount, rules: domain.ruleCount, host: domain.mailHostname || data?.mailHost || t('common.notConfigured') })}</p></div>
                  <div className="dns-auto-domain-checked">{domain.checkedAt ? t('environment.checkedAt', { time: new Date(domain.checkedAt).toLocaleString(dateLocale) }) : t('common.notChecked')}</div>
                </header>
                <section className="dns-auto-domain-status" aria-label={t('environment.domainCheckAria', { domain: domain.name })}>
                  <div className="dns-auto-domain-status-heading"><h3>{t('environment.dnsCheckTitle')}</h3><span>{total ? t('environment.matchCount', { passed, total }) : t('environment.pendingCheck')}</span></div>
                  <div className="dns-domain-row-records">{domain.items.length ? domain.items.map((item) => <span className={`dns-record-chip ${item.ok ? 'is-ok' : 'is-missing'}`} key={item.key}><span aria-hidden="true">{item.ok ? '✓' : '!'}</span>{checkItemLabel(item, t)}</span>) : <span className="dns-record-chip is-pending">{t('environment.awaitingFirstCheck')}</span>}</div>
                </section>
                <div className="dns-auto-domain-footer">
                  <button type="button" onClick={() => void recheckDomain(domain.id)} disabled={checkingDomain !== null || checking}>{checkingDomain === domain.id ? t('environment.checking') : t('environment.recheckDns')}</button>
                  <DnsPanel domainId={domain.id} domainName={domain.name} view="automatic" onSynced={() => void load()} />
                </div>
              </article>
            })}
            {data?.domains.length === 0 && <p className="dns-domain-empty">{t('environment.noDomainsYet')}<Link href="/domains">{t('environment.goToDomains')}</Link></p>}
            <p className="dns-domain-overview-footnote">{t('environment.shareHostLead')} <span className="mono">{data?.mailHost || t('common.notConfigured')}</span>{t('environment.domainsManagedLead')}<Link href="/domains">{t('environment.domainsLink')}</Link>{t('environment.domainsManagedTail')}</p>
          </div>}
          {dnsTab === 'advanced' && (() => {
            const domain = data?.domains.find((item) => item.id === selectedDomainId) ?? data?.domains[0]
            return domain ? <div className="dns-advanced-tab"><div className="dns-tab-heading"><div><p className="dns-section-kicker">{t('environment.advancedKicker')}</p><h2>{t('environment.advancedTitle')}</h2><p>{t('environment.advancedDesc')}</p></div><label className="dns-domain-select">{t('common.domain')}<select value={domain.id} onChange={(event) => selectDomain(Number(event.target.value))}>{data?.domains.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div><DnsPanel domainId={domain.id} domainName={domain.name} view="advanced" /></div> : <p className="empty">{t('environment.advancedEmpty')}</p>
          })()}
          {dnsTab === 'manual' && (() => {
            const domain = data?.domains.find((item) => item.id === selectedDomainId) ?? data?.domains[0]
            return domain ? <div className="dns-manual-tab"><div className="dns-tab-heading"><div><p className="dns-section-kicker">{t('environment.manualKicker')}</p><h2>{t('environment.manualTitle')}</h2><p>{t('environment.manualDesc')}</p></div><label className="dns-domain-select">{t('common.domain')}<select value={domain.id} onChange={(event) => selectDomain(Number(event.target.value))}>{data?.domains.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div><DnsPanel domainId={domain.id} domainName={domain.name} view="manual" /></div> : <p className="empty">{t('environment.manualEmpty')}</p>
          })()}
        </section>
      </div> : <section className="panel environment-dns-tls" id="dns-tls">
        <div className="section-title environment-dns-tls-heading"><div><h2>{t('environment.mailDomainsTitle')}</h2><p className="hint">{t('environment.dnsTlsHint', { host: data?.mailHost || t('environment.mailHostUnset') })}</p></div>{data?.domains.length ? <span className="count">{t('environment.domainCount', { count: data.domains.length })}</span> : null}</div>
        <section className="environment-domains"><div className="section-title environment-domain-heading"><div><h3>{t('environment.configuredDomains')}</h3><p className="hint">{t('environment.domainsManagedLead')}<Link href="/domains">{t('environment.domainsLink')}</Link>{t('environment.domainsManagedTail')}</p></div></div>
          {data?.domains.length === 0 && <p className="empty">{t('environment.noMailDomainsLead')}<Link href="/domains">{t('environment.domainsLink')}</Link>{t('environment.addDomainTail')}</p>}
          {data?.domains.map((domain) => <div className="environment-domain" key={domain.id}>
            <div className="environment-domain-name"><div className="environment-domain-title"><b className="mono">{domain.name}</b><span className={`tag ${domain.active ? 'ok' : 'warn'}`}>{domain.active ? t('common.active') : t('common.disabled')}</span></div><p className="hint">{domain.checkedAt ? t('environment.dnsCheckedAt', { time: new Date(domain.checkedAt).toLocaleString(dateLocale) }) : t('environment.dnsNotCheckedYet')}</p></div>
            <div className="environment-domain-checks" aria-label={t('environment.domainCheckStatusAria', { domain: domain.name })}>{domain.items.length ? domain.items.map((item) => <span className={`tag ${item.ok ? 'ok' : 'err'}`} key={item.key}>{checkItemLabel(item, t)}</span>) : <span className="tag warn">{t('environment.dnsPending')}</span>}</div>
            <div className="environment-domain-actions"><span className="count">{t('environment.domainCountsShort', { mailboxes: domain.mailboxCount, rules: domain.ruleCount })}</span><button type="button" onClick={() => void recheckDomain(domain.id)} disabled={checkingDomain !== null || checking}>{checkingDomain === domain.id ? t('environment.checking') : t('environment.checkDns')}</button></div>
          </div>)}
        </section>
      </section>}
    </>}
  </main>
}
