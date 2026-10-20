'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

type Overview = {
  reachable: boolean
  stat: Record<string, unknown> | null
  symbols: Array<{ name: string; weight: number; frequency: number }>
  actions: Record<string, number>
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeOverview(value: unknown): Overview {
  const raw = isRecord(value) ? value : {}
  const rawStat = isRecord(raw.stat) ? raw.stat : null
  const symbols = Array.isArray(raw.symbols)
    ? raw.symbols.flatMap((item) => {
        if (!isRecord(item) || typeof item.name !== 'string') return []
        return [{ name: item.name, weight: finiteNumber(item.weight) ?? 0, frequency: finiteNumber(item.frequency) ?? 0 }]
      })
    : []
  const actions = isRecord(raw.actions)
    ? Object.fromEntries(Object.entries(raw.actions).flatMap(([name, count]) => {
        const value = finiteNumber(count)
        return value === null ? [] : [[name, value]]
      }))
    : {}
  return {
    reachable: raw.reachable === true,
    stat: rawStat,
    symbols,
    actions,
    error: typeof raw.error === 'string' ? raw.error : undefined,
  }
}

function StatNum({ v }: { v: unknown }) {
  const n = finiteNumber(v)
  return <span className={n === 0 ? 'value zero' : 'value'}>{n ?? '—'}</span>
}

export default function SpamMonitorPage() {
  const { t } = useI18n()
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/system/spam-stats', { cache: 'no-store' })
      const body: unknown = await res.json()
      if (!res.ok) throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : t('monitor.loadFailedStatus', { status: res.status }))
      setData(normalizeOverview(body))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitor.spamLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 10_000)
    return () => clearInterval(timer)
  }, [load])

  const stat = data?.stat ?? null
  const scanned = stat?.scanned ?? stat?.['total'] ?? null
  const rejected = stat?.rejected ?? null

  return (
    <main className="wrap">
      <div className="topbar">
        <span className="logo">🍀</span>
        <h1>{t('monitor.spamTitle')}</h1>
        <span className="tag">{t('monitor.spamTag')}</span>
      </div>

      {error && <div className="banner" role="alert">{t('monitor.spamRequestFailed', { error })}</div>}

      {!data?.reachable && !error && (
        <div className="banner">
          {t('monitor.spamUnreachable', { detail: loading ? t('common.loading') : data?.error ?? t('monitor.dockerUnavailable') })}
        </div>
      )}

      {error && <button type="button" onClick={() => void load()} disabled={loading}>{loading ? t('monitor.retrying') : t('common.retry')}</button>}

      <div className="spam-stats">
        <div className="spam-stat">
          <div className="spam-stat-label">{t('monitor.statScanned')}</div>
          <StatNum v={scanned} />
        </div>
        <div className="spam-stat">
          <div className="spam-stat-label">{t('monitor.statRejected')}</div>
          <StatNum v={rejected} />
        </div>
        <div className="spam-stat">
          <div className="spam-stat-label">{t('monitor.statSoftRejected')}</div>
          <StatNum v={stat?.soft_rejected ?? stat?.softRejected ?? null} />
        </div>
        <div className="spam-stat">
          <div className="spam-stat-label">{t('monitor.statSymbols')}</div>
          <StatNum v={data?.symbols?.length ?? 0} />
        </div>
      </div>

      {data?.actions && Object.keys(data.actions).length > 0 && (
        <section className="panel">
          <h2>{t('monitor.actionDistribution')}</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>{t('monitor.colAction')}</th>
                <th>{t('monitor.colCount')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.actions)
                .sort((a, b) => b[1] - a[1])
                .map(([action, count]) => (
                  <tr key={action}>
                    <td>{action}</td>
                    <td>{count}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel">
        <h2>{t('monitor.symbolsTopN')}</h2>
        {data?.symbols && data.symbols.length > 0 ? (
          <table className="grid">
            <thead>
              <tr>
                <th>{t('monitor.colSymbol')}</th>
                <th>{t('monitor.colHits')}</th>
                <th>{t('monitor.colWeight')}</th>
              </tr>
            </thead>
            <tbody>
              {data.symbols.map((s) => (
                <tr key={s.name}>
                  <td className="mono">{s.name}</td>
                  <td>{s.frequency}</td>
                  <td>
                    <span className={'tag ' + (s.weight > 0 ? 'err' : s.weight < 0 ? 'ok' : '')}>{s.weight}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">{t('monitor.noSymbols')}</p>
        )}
      </section>

      <p className="hint">
        {t('monitor.spamWebuiHint')}
      </p>
    </main>
  )
}
