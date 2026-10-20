'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'
import type { MessageKey } from '@/lib/i18n/types'
import { checkItemLabel } from '@/components/check-item-label'

type GeneratedRecord = { type: string; name: string; content: string; ttl: number; priority?: number; cloverTag: string; purpose: string }
type CheckItem = { key: string; label: string; ok: boolean; expected: string; actual: string }

const RECORD_CHECK_KEYS: Record<string, string> = {
  'clover-ownership': 'ownership', 'clover-mail-a': 'mail-a', 'clover-mx': 'mx',
  'clover-spf': 'spf', 'clover-dkim': 'dkim', 'clover-dmarc': 'dmarc',
}
type PushResult = { noop?: boolean; posted?: number; patched?: number; deleted?: number; changes?: { added: string[]; updated: string[]; deleted: string[] }; check?: { passed: number; total: number; attempts?: number } }
type DnsData = {
  domain: { id: number; name: string; mailHostname: string | null }
  records: Array<{ id: number; type: string; name: string; content: string; status: string; comment: string | null }>
  generated: GeneratedRecord[]
  checklist: { items: CheckItem[]; checkedAt: string } | null
  settings: { vpsIp: string; dmarcPolicy: string; spfStrict: boolean; advancedDns: boolean }
}

export default function DnsPanel({ domainId, domainName, view, onSynced }: { domainId: number; domainName: string; view: 'automatic' | 'advanced' | 'manual'; onSynced?: () => void }) {
  const { t, dateLocale } = useI18n()
  const [data, setData] = useState<DnsData | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const load = useCallback(async () => { const res = await fetch(`/api/v1/domains/${domainId}/dns`, { cache: 'no-store' }); if (res.ok) setData(await res.json()) }, [domainId])
  useEffect(() => { void load() }, [load])

  async function post(action: 'generate' | 'push' | 'check') {
    const url = `/api/v1/domains/${domainId}/dns${action === 'generate' ? '' : `/${action}`}`
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    const result = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(result.error ?? t('dns.requestFailed', { status: res.status }))
    return result
  }
  async function syncToCloudflare() {
    setBusy('sync'); setMsg(null)
    try {
      await post('generate')
      const result = await post('push') as PushResult
      const summary = result.noop ? t('dns.cfUpToDate') : t('dns.syncSummary', { posted: result.posted ?? 0, patched: result.patched ?? 0, deleted: result.deleted ?? 0 })
      const checked = result.check ? t('dns.checkMatchSummary', { passed: result.check.passed, total: result.check.total }) : ''
      setMsg({ ok: true, text: `${summary}${checked}` })
      await load()
      onSynced?.()
    } catch (error) { setMsg({ ok: false, text: String(error) }) }
    finally { setBusy(null) }
  }
  async function act(action: 'generate' | 'check') {
    setBusy(action); setMsg(null)
    try {
      const result = await post(action)
      if (action === 'check') { const passed = (result.items ?? []).filter((item: CheckItem) => item.ok).length; setMsg({ ok: true, text: t('dns.checkSummary', { passed, total: (result.items ?? []).length }) }) }
      else setMsg({ ok: true, text: t('dns.generatedCount', { count: result.count ?? 0 }) })
      await load()
    } catch (error) { setMsg({ ok: false, text: String(error) }) }
    finally { setBusy(null) }
  }
  if (!data) return <p className="dns-panel-loading" role="status">{t('dns.loadingPanel')}</p>

  const dkimMissing = !data.generated.some((record) => record.cloverTag === 'clover-dkim')
  const items = data.checklist?.items ?? []
  const pushed = data.records.filter((record) => record.status === 'pushed').length
  return <div className="dns-panel-stack">
    {view === 'automatic' && <section className="dns-auto-sync">
      <div className="dns-auto-sync-copy"><p className="eyebrow"><span className="status-dot"/>Cloudflare</p><p>{t('dns.autoSyncDesc')}</p></div>
      <div className="dns-auto-sync-action"><span>{t('dns.recordsSummary', { total: data.generated.length, pushed })}</span><button className="primary" type="button" onClick={syncToCloudflare} disabled={busy !== null}>{busy === 'sync' ? t('dns.syncing') : t('dns.pushToCloudflare')}<span aria-hidden="true">→</span></button></div>
      {msg && <div role="status" className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
    </section>}
    {view === 'advanced' && <section className="advanced-body dns-advanced-content">
      <div className="advanced-actions"><button type="button" disabled={busy !== null} onClick={() => act('generate')}>{busy === 'generate' ? t('dns.generating') : t('dns.regenerate')}</button><a className="btn-link" href={`/api/v1/domains/${domainId}/dns/export?format=bind`}>{t('dns.exportBind')}</a><a className="btn-link" href={`/api/v1/domains/${domainId}/dns/export?format=text`}>{t('dns.exportTxt')}</a></div>
      <p className="hint">{t('dns.advancedDesc')}</p>
      {dkimMissing && <p className="hint warning-copy">{t('dns.dkimMissing')}</p>}
      <div className="section-title"><h3>{t('dns.recordPreview')}</h3><span className="count">{t('dns.previewMeta', { vpsIp: data.settings.vpsIp || t('dns.notSet'), policy: data.settings.dmarcPolicy })}</span></div>
      <div className="table-scroll"><table className="grid"><thead><tr><th>{t('dns.colType')}</th><th>{t('common.name')}</th><th>{t('dns.colContent')}</th><th>{t('dns.colPurpose')}</th><th>{t('common.status')}</th></tr></thead><tbody>{data.generated.map((record) => {
        const stored = data.records.find((item) => item.type === record.type && item.name === record.name && item.comment === record.cloverTag)
        const check = items.find((item) => item.key === RECORD_CHECK_KEYS[record.cloverTag])
        const status: { label: MessageKey; tone: string } = check?.ok ? { label: 'dns.statusMatch', tone: 'ok' } : check ? { label: 'dns.statusMismatch', tone: 'warn' } : { label: stored?.status === 'pushed' ? 'dns.statusPushed' : 'dns.statusNotChecked', tone: '' }
        return <tr key={record.cloverTag}><td>{record.type}</td><td className="mono">{record.name === '@' ? domainName : `${record.name}.${domainName}`}</td><td className="mono record-content">{record.content}</td><td>{record.purpose}</td><td><span className={'tag ' + status.tone}>{t(status.label)}</span></td></tr>
      })}</tbody></table></div>
      {items.length > 0 && <><div className="section-title detail-check-title"><h3>{t('dns.checkDetailTitle')}</h3><span className="count">{data.checklist?.checkedAt ? t('dns.checkedAt', { time: new Date(data.checklist.checkedAt).toLocaleString(dateLocale) }) : ''}</span></div><div className="table-scroll"><table className="grid"><thead><tr><th>{t('dns.colItem')}</th><th>{t('dns.colResult')}</th><th>{t('dns.colExpected')}</th><th>{t('dns.colActual')}</th></tr></thead><tbody>{items.map((item) => <tr key={item.key}><td>{checkItemLabel(item, t)}</td><td><span className={'tag ' + (item.ok ? 'ok' : 'err')}>{item.ok ? t('dns.statusMatch') : t('dns.statusMismatch')}</span></td><td className="mono record-content">{item.expected || '—'}</td><td className="mono record-content">{item.actual || '—'}</td></tr>)}</tbody></table></div></>}
    </section>}
    {view === 'manual' && <section className="panel dns-manual-reference"><p className="hint">{t('dns.manualIntroLead')} <b className="mono">{domainName}</b>{t('dns.manualIntroTail')}</p><div className="table-scroll"><table className="grid"><thead><tr><th>{t('dns.colType')}</th><th>{t('common.name')}</th><th>{t('dns.colRecordValue')}</th><th>{t('dns.colPriority')}</th><th>TTL</th><th>{t('dns.colPurpose')}</th></tr></thead><tbody>{data.generated.map((record) => <tr key={record.cloverTag}><td>{record.type}</td><td className="mono">{record.name === '@' ? domainName : `${record.name}.${domainName}`}</td><td className="mono record-content">{record.content}</td><td>{record.priority ?? '—'}</td><td>{record.ttl}</td><td>{record.purpose}</td></tr>)}</tbody></table></div><div className="dns-manual-note"><b>{t('dns.manualNoteTitle')}</b><span>{t('dns.manualNote')}</span></div></section>}
  </div>
}
