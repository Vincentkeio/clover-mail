'use client'

import Link from 'next/link'
import { useState } from 'react'
import DeleteButton from '@/components/delete-button'
import { useI18n } from '@/lib/i18n/client'
import type { Translator } from '@/lib/i18n/translate'
import type { MessageKey } from '@/lib/i18n/types'
import RuleForm from './rule-form'

type Domain = { id: number; name: string; active: boolean }
type Rule = { id: number; domainId: number; matchType: string; matchValue: string | null; targets: string; priority: number; active: boolean }

const MATCH_TYPE_LABEL: Record<string, MessageKey> = { exact: 'routing.matchExact', prefix: 'routing.matchPrefix', nonuser: 'routing.matchNonUser', catchall: 'routing.matchCatchall' }

/** 规则类型由接口存储，按 matchType 取词条；取不到时回退到原始值。 */
function matchTypeLabel(matchType: string, t: Translator): string {
  const key = MATCH_TYPE_LABEL[matchType]
  return key ? t(key) : matchType
}

function parseTargets(json: string): string[] {
  try { const value: unknown = JSON.parse(json); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
  catch { return [] }
}

export default function RoutingManager({ domains, rules, mailboxes }: { domains: Domain[]; rules: Rule[]; mailboxes: string[] }) {
  const { t } = useI18n()
  const [domainId, setDomainId] = useState(domains.find((domain) => domain.active)?.id ?? domains[0]?.id ?? 0)
  const selected = domains.find((domain) => domain.id === domainId)
  const selectedRules = rules.filter((rule) => rule.domainId === domainId)

  return <main className="wrap">
    <div className="topbar"><div><p className="eyebrow">MAIL / ROUTING</p><h1>{t('routing.title')}</h1><p className="hint">{t('routing.intro')}</p></div></div>
    {domains.length ? <>
      <section className="panel">
        <div className="section-title"><div><h2>{t('routing.chooseDomainTitle')}</h2><p className="hint">{t('routing.chooseDomainHint')}</p></div><span className="count">{t('routing.domainCount', { count: domains.length })}</span></div>
        <label className="field routing-domain-picker">{t('common.domain')}<select value={domainId} onChange={(event) => setDomainId(Number(event.target.value))}>{domains.map((domain) => <option value={domain.id} key={domain.id}>{domain.active ? domain.name : t('routing.domainOptionInactive', { name: domain.name })}</option>)}</select></label>
      </section>
      {selected && <>
        <section className="panel">
          <div className="section-title"><div><h2>{t('routing.addTitle')}</h2><p className="hint">{t('routing.addHint')}</p></div></div>
          {selected.active ? <RuleForm domainId={selected.id} domainName={selected.name} mailboxes={mailboxes} /> : <p className="msg warn">{t('routing.domainInactive')}</p>}
        </section>
        <section className="panel">
          <div className="section-title"><div><h2>{t('routing.rulesTitle', { name: selected.name })}</h2><p className="hint">{t('routing.rulesHint')}</p></div><span className="count">{t('routing.ruleCount', { count: selectedRules.length })}</span></div>
          {selectedRules.length ? <div className="table-scroll"><table className="grid"><thead><tr><th>{t('routing.colType')}</th><th>{t('routing.colMatchAddress')}</th><th>{t('routing.colForwardTo')}</th><th>{t('routing.priority')}</th><th>{t('common.status')}</th><th>{t('common.actions')}</th></tr></thead><tbody>{selectedRules.map((rule) => <tr key={rule.id}><td>{matchTypeLabel(rule.matchType, t)}</td><td className="mono">{rule.matchType === 'prefix' ? `${rule.matchValue}*@${selected.name}` : rule.matchValue ?? `@${selected.name}`}</td><td className="mono">{parseTargets(rule.targets).join(', ') || '—'}</td><td>{rule.priority}</td><td><span className={`tag ${rule.active ? 'ok' : 'err'}`}>{rule.active ? t('common.active') : t('common.inactive')}</span></td><td><DeleteButton url={`/api/v1/rules/${rule.id}`} confirmText={t('routing.confirmDelete')} /></td></tr>)}</tbody></table></div> : <p className="empty">{t('routing.emptyRules')}</p>}
        </section>
      </>}
    </> : <section className="panel"><p className="empty">{t('routing.noDomainsLead')}<Link href="/domains">{t('nav.domains')}</Link>{t('routing.noDomainsTail')}</p></section>}
  </main>
}
