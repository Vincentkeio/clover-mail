'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

type Zone = { id: string; name: string; status: string; account: string | null; imported: boolean }
type ItemResult = {
  name: string
  created?: boolean
  generated?: number
  push?: { domain: string; ok: boolean; posted?: number; patched?: number; deleted?: number; changes?: { added: string[]; updated: string[]; deleted: string[] }; check?: { passed: number; total: number }; noop?: boolean; error?: string }
}
type PushOutcome = { domain: string; ok: boolean; posted?: number; patched?: number; deleted?: number; changes?: { added: string[]; updated: string[]; deleted: string[] }; check?: { passed: number; total: number }; noop?: boolean; error?: string }

export default function CloudflarePanel({ tokenSet: initialTokenSet, tokenMasked: initialTokenMasked }: { tokenSet: boolean; tokenMasked: string | null }) {
  const { t } = useI18n()
  const [tokenSet, setTokenSet] = useState(initialTokenSet)
  const [tokenMasked, setTokenMasked] = useState(initialTokenMasked)
  const [token, setToken] = useState('')
  const [zones, setZones] = useState<Zone[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [results, setResults] = useState<ItemResult[] | PushOutcome[] | null>(null)
  const [resultKind, setResultKind] = useState<'import' | 'pushall' | null>(null)

  async function saveToken(e: React.FormEvent) {
    e.preventDefault()
    if (!token.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cfApiToken: token.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? t('cloudflare.saveFailedStatus', { status: res.status }))
      setToken('')
      setTokenSet(true)
      setTokenMasked(data.cfTokenMasked ?? t('common.saved'))
      setMsg({ ok: true, text: t('cloudflare.tokenSaved') })
      await loadZones()
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }

  async function clearToken() {
    if (!window.confirm(t('cloudflare.confirmClearToken'))) return
    setBusy(true)
    try {
      const res = await fetch('/api/v1/settings', { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? t('cloudflare.clearFailedStatus', { status: res.status }))
      setTokenSet(false); setTokenMasked(null); setZones(null); setMsg({ ok: true, text: t('cloudflare.tokenCleared') })
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }

  const loadZones = useCallback(async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/v1/cloudflare/zones')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setZones([])
        setMsg({ ok: false, text: data.error ?? t('cloudflare.fetchFailedStatus', { status: res.status }) })
        return
      }
      setZones(data.zones ?? [])
      setMsg({
        ok: true,
        text: t('cloudflare.zonesLoaded', { total: data.zones?.length ?? 0, imported: data.zones?.filter((z: Zone) => z.imported).length ?? 0 }),
      })
    } finally {
      setBusy(false)
    }
  }, [t])

  useEffect(() => {
    if (initialTokenSet) void loadZones()
  }, [initialTokenSet, loadZones])

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function runImport(names: string[] | 'all') {
    setBusy(true)
    setMsg(null)
    setResults(null)
    try {
      const res = await fetch('/api/v1/cloudflare/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names, push: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? t('cloudflare.failedStatus', { status: res.status }) })
        return
      }
      setResults(data.results ?? [])
      setResultKind('import')
      setMsg({
        ok: data.ok === data.total,
        text: t('cloudflare.importSummary', { total: data.total, ok: data.ok, failed: data.total - data.ok }),
      })
      await loadZones()
    } finally {
      setBusy(false)
    }
  }

  async function runPushAll() {
    setBusy(true)
    setMsg(null)
    setResults(null)
    try {
      const res = await fetch('/api/v1/cloudflare/push-all', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? t('cloudflare.failedStatus', { status: res.status }) })
        return
      }
      setResults(data.results ?? [])
      setResultKind('pushall')
      setMsg({
        ok: data.ok === data.total,
        text: t('cloudflare.pushAllSummary', { total: data.total, ok: data.ok, posted: data.posted, patched: data.patched, deleted: data.deleted }),
      })
    } finally {
      setBusy(false)
    }
  }

  const connectionPanel = <section className="panel cf-connection-panel">
    <div className="section-title"><div><h2>{t('cloudflare.accountConnection')}</h2><p className="hint">{t('cloudflare.accountConnectionHint')}</p></div><span className={'tag ' + (tokenSet ? 'ok' : '')}>{tokenSet ? t('cloudflare.connectedMasked', { masked: tokenMasked ?? '' }) : t('cloudflare.notConnected')}</span></div>
    <section className="cf-token-guide" aria-labelledby="cf-token-guide-title">
      <div className="cf-token-guide-heading"><h3 id="cf-token-guide-title">{t('cloudflare.tokenGuideTitle')}</h3><a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">{t('cloudflare.tokenGuideLink')}</a></div>
      <ol>
        <li>{t('cloudflare.tokenGuideStep1')}</li>
        <li>{t('cloudflare.tokenGuideStep2')}</li>
        <li>{t('cloudflare.tokenGuideStep3')}</li>
        <li>{t('cloudflare.tokenGuideStep4')}</li>
        <li>{t('cloudflare.tokenGuideStep5')}</li>
        <li>{t('cloudflare.tokenGuideStep6')}</li>
        <li>{t('cloudflare.tokenGuideStep7')}</li>
      </ol>
      <p>{t('cloudflare.tokenGuideNote')}</p>
    </section>
    <form onSubmit={saveToken}>
      <div className="form-row cf-token-row"><div className="field"><label htmlFor="cf-api-token">Cloudflare API Token</label><input id="cf-api-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={tokenSet ? t('cloudflare.tokenPlaceholderReplace') : t('cloudflare.tokenPlaceholderPaste')} /></div>{tokenSet && <button type="button" className="danger" onClick={clearToken} disabled={busy}>{t('cloudflare.disconnect')}</button>}<button className="primary" type="submit" disabled={busy || !token.trim()}>{busy ? t('cloudflare.working') : tokenSet ? t('cloudflare.updateToken') : t('cloudflare.connect')}</button></div>
    </form>
    <p className="hint">{t('cloudflare.tokenStorageHint')}</p>
    {msg && <div role="status" className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
  </section>

  if (!tokenSet) return <>{connectionPanel}<section className="panel"><h2>{t('cloudflare.lockedTitle')}</h2><p className="hint">{t('cloudflare.lockedHint')}</p></section></>

  const pending = (zones ?? []).filter((z) => !z.imported)
  const allPendingSelected = pending.length > 0 && pending.every((z) => selected.has(z.name))

  return (
    <>
      {connectionPanel}
      <section className="panel">
        <div className="section-title">
          <h2>{t('cloudflare.domainsTitle')}</h2>
          <span className="count">{t('cloudflare.domainCount', { count: (zones ?? []).length })}</span>
        </div>
        <p className="hint">
          {t('cloudflare.importHint')}
        </p>

        {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}

        <div className="form-row" style={{ marginBottom: 12 }}>
          <button className="primary" onClick={() => runImport('all')} disabled={busy || pending.length === 0} type="button">
            {busy ? t('cloudflare.working') : t('cloudflare.importAllButton', { count: pending.length })}
          </button>
          <button
            onClick={() => runImport([...selected])}
            disabled={busy || selected.size === 0}
            type="button"
          >
            {t('cloudflare.importSelectedButton', { count: selected.size })}
          </button>
          <button onClick={loadZones} disabled={busy} type="button">
            {t('cloudflare.refreshList')}
          </button>
        </div>

        {zones === null ? (
          <p className="empty">{t('cloudflare.zonesLoading')}</p>
        ) : zones.length === 0 ? (
          <p className="empty">{t('cloudflare.zonesEmpty')}</p>
        ) : (
          <div className="table-scroll"><table className="grid">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={allPendingSelected}
                    onChange={(e) => {
                      const next = new Set(selected)
                      for (const z of pending) {
                        if (e.target.checked) next.add(z.name)
                        else next.delete(z.name)
                      }
                      setSelected(next)
                    }}
                    title={t('cloudflare.selectAllPendingTitle')}
                  />
                </th>
                <th>{t('common.domain')}</th>
                <th>{t('cloudflare.cfStatus')}</th>
                <th>{t('cloudflare.panelColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(z.name)}
                      onChange={() => toggle(z.name)}
                    />
                  </td>
                  <td className="mono">{z.name}</td>
                  <td>
                    <span className={'tag ' + (z.status === 'active' ? 'ok' : '')}>{z.status}</span>
                  </td>
                  <td>
                    {z.imported ? (
                      <span className="tag ok">{t('cloudflare.imported')}</span>
                    ) : (
                      <span className="hint-text">{t('cloudflare.notImported')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="panel">
          <h2>{t('cloudflare.bulkSyncTitle')}</h2>
        <p className="hint">
          {t('cloudflare.bulkSyncHint')}
        </p>
        <div className="form-row">
          <button className="primary" onClick={runPushAll} disabled={busy} type="button">
            {busy ? t('cloudflare.pushing') : t('cloudflare.pushAllButton')}
          </button>
        </div>
      </section>

      {results && (
        <section className="panel">
          <h2>{t('cloudflare.resultsTitle')}</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>{t('common.domain')}</th>
                {resultKind === 'import' && <th>{t('cloudflare.colCreate')}</th>}
                {resultKind === 'import' && <th>{t('cloudflare.colGenerate')}</th>}
                <th>{t('cloudflare.colPush')}</th>
                <th>{t('cloudflare.colDetail')}</th>
              </tr>
            </thead>
            <tbody>
              {(results as Array<ItemResult & PushOutcome>).map((r) => {
                const p = r.push ?? r
                const ok = p?.ok !== false
                const domainName = r.name ?? p?.domain ?? '—'
                return (
                  <tr key={`${resultKind}-${domainName}`}>
                    <td className="mono">{domainName}</td>
                    {resultKind === 'import' && <td>{r.created ? t('cloudflare.resultCreated') : t('cloudflare.resultExisting')}</td>}
                    {resultKind === 'import' && <td>{r.generated ?? '—'}</td>}
                    <td>
                      <span className={'tag ' + (ok ? 'ok' : 'err')}>{ok ? t('cloudflare.pushOk') : t('cloudflare.pushFailed')}</span>
                    </td>
                    <td className="hint-text">
                      {ok ? <>
                        <div>{p?.noop ? t('cloudflare.recordsUpToDate') : t('cloudflare.pushCounts', { posted: p?.posted ?? 0, patched: p?.patched ?? 0, deleted: p?.deleted ?? 0 })}</div>
                        {p?.changes?.updated.map((item) => <div key={`updated-${item}`}>{t('cloudflare.changeUpdated', { item })}</div>)}
                        {p?.changes?.added.map((item) => <div key={`added-${item}`}>{t('cloudflare.changeAdded', { item })}</div>)}
                        {p?.changes?.deleted.map((item) => <div key={`deleted-${item}`}>{t('cloudflare.changeDeleted', { item })}</div>)}
                        {p?.check && <div>{t('cloudflare.dnsCheckPassed', { passed: p.check.passed, total: p.check.total })}{p.check.passed < p.check.total ? t('cloudflare.dnsCheckStale') : ''}</div>}
                      </> : p?.error}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}
