'use client'

import { useState } from 'react'
import { useI18n } from '@/lib/i18n/client'
import type { DnsblResult } from '@/lib/dnsbl'

type HealthItem = { key: string; label: string; ok: boolean; detail: string }
type Result = {
  ip: string | null
  domain: string | null
  dnsbl: { ip: string; results: DnsblResult[]; reachable: boolean } | null
  health: { domain: string; mailHostname: string; items: HealthItem[] } | null
}

export default function DeliverabilityPage() {
  const { t } = useI18n()
  const [data, setData] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [messageTone, setMessageTone] = useState<'ok' | 'warn' | 'err'>('ok')

  async function run() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/v1/system/deliverability', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessageTone('err')
        setMsg(body.error ?? t('monitor.failedStatus', { status: res.status }))
        return
      }
      setData(body)
      const listed = body.dnsbl?.results?.filter((r: DnsblResult) => r.listed).length ?? 0
      const failed = body.health?.items?.filter((i: HealthItem) => !i.ok).length ?? 0
      const uncertain = body.dnsbl?.results?.filter((r: DnsblResult) => r.error).length ?? 0
      setMessageTone(listed || failed || uncertain ? 'warn' : 'ok')
      setMsg(
        t('monitor.checkSummary', { listed, uncertain, failed }),
      )
    } catch (error) {
      setMessageTone('err'); setMsg(error instanceof Error ? error.message : t('monitor.checkFailed'))
    } finally {
      setBusy(false)
    }
  }

  const listed = data?.dnsbl?.results?.filter((r) => r.listed) ?? []

  return (
    <main className="wrap">
      <div className="topbar">
        <span className="logo">🍀</span>
        <h1>{t('monitor.deliverabilityTitle')}</h1>
        <span className="tag">{t('monitor.deliverabilityTag')}</span>
      </div>

      <div className="form-row">
        <button className="primary" onClick={run} disabled={busy} type="button">
          {busy ? t('monitor.checking') : t('monitor.startCheck')}
        </button>
        {msg && <div className={'msg ' + messageTone} role="status" style={{ flexBasis: '100%' }}>{msg}</div>}
      </div>

      <p className="hint">
        {t('monitor.dnsblHint')}
      </p>

      {data?.dnsbl && (
        <section className="panel">
          <h2>{t('monitor.ipBlocklistTitle', { ip: data.dnsbl.ip })}</h2>
          <div className="table-scroll"><table className="grid">
            <thead>
              <tr>
                <th>{t('monitor.colBlocklist')}</th>
                <th>{t('monitor.colResult')}</th>
                <th>{t('monitor.colDetail')}</th>
              </tr>
            </thead>
            <tbody>
              {data.dnsbl.results.map((r) => (
                <tr key={r.zone}>
                  <td>{r.label}</td>
                  <td>
                    {r.error ? (
                      <span className="tag warn">{r.status === 'restricted' ? t('monitor.queryRestricted') : t('monitor.queryFailed')}</span>
                    ) : r.listed ? (
                      <span className="tag err">{t('monitor.listed')}</span>
                    ) : (
                      <span className="tag ok">{t('monitor.notListed')}</span>
                    )}
                  </td>
                  <td className="hint-text">{[r.detail, r.error].filter(Boolean).join(t('monitor.detailSeparator')) || t('monitor.notListedDetail')}{r.zone === 'zen.spamhaus.org' && r.error && <> <a href="https://check.spamhaus.org/" target="_blank" rel="noreferrer">{t('monitor.verifyOnSite')}</a></>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {listed.length === 0 && !data.dnsbl.results.some((r) => r.error) && (
            <p className="msg ok">{t('monitor.allClear', { count: data.dnsbl.results.length })}</p>
          )}
          <p className="hint">{t('monitor.dnsblDisclaimer')}</p>
        </section>
      )}

      {data?.health && (
        <section className="panel">
          <h2>{t('monitor.domainHealthTitle', { domain: data.health.domain })}</h2>
          <div className="table-scroll"><table className="grid">
            <thead>
              <tr>
                <th>{t('monitor.colCheck')}</th>
                <th>{t('monitor.colResult')}</th>
                <th>{t('monitor.colDetail')}</th>
              </tr>
            </thead>
            <tbody>
              {data.health.items.map((i) => (
                <tr key={i.key}>
                  <td>{i.label}</td>
                  <td>
                    <span className={'tag ' + (i.ok ? 'ok' : 'err')}>{i.ok ? t('monitor.passed') : t('monitor.notPassed')}</span>
                  </td>
                  <td className="mono hint-text" style={{ wordBreak: 'break-all' }}>
                    {i.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      <p className="hint">
        {t('monitor.related')}<a href="/monitor/spam">{t('monitor.linkSpam')}</a> · <a href="/monitor/queue">{t('monitor.linkQueue')}</a>
      </p>
    </main>
  )
}
