'use client'

import { useCallback, useEffect, useState } from 'react'

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
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/system/spam-stats', { cache: 'no-store' })
      const body: unknown = await res.json()
      if (!res.ok) throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : `读取失败（${res.status}）`)
      setData(normalizeOverview(body))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '反垃圾统计读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 10_000)
    return () => clearInterval(t)
  }, [load])

  const stat = data?.stat ?? null
  const scanned = stat?.scanned ?? stat?.['total'] ?? null
  const rejected = stat?.rejected ?? null

  return (
    <main className="wrap">
      <div className="topbar">
        <span className="logo">🍀</span>
        <h1>反垃圾监控</h1>
        <span className="tag">rspamd · 10s 自动刷新</span>
      </div>

      {error && <div className="banner" role="alert">反垃圾统计请求失败：{error}</div>}

      {!data?.reachable && !error && (
        <div className="banner">
          未连接到 DMS（面板通过 docker exec 读取 rspamd 统计）。
          部署到 VPS 后这里会显示真实数据：{loading ? '加载中…' : data?.error ?? 'docker 不可用'}
        </div>
      )}

      {error && <button type="button" onClick={() => void load()} disabled={loading}>{loading ? '正在重试…' : '重试'}</button>}

      <div className="spam-stats">
        <div className="spam-stat">
          <div className="spam-stat-label">已扫描</div>
          <StatNum v={scanned} />
        </div>
        <div className="spam-stat">
          <div className="spam-stat-label">已拒绝</div>
          <StatNum v={rejected} />
        </div>
        <div className="spam-stat">
          <div className="spam-stat-label">软拒绝（加标头）</div>
          <StatNum v={stat?.soft_rejected ?? stat?.softRejected ?? null} />
        </div>
        <div className="spam-stat">
          <div className="spam-stat-label">符号命中种类</div>
          <StatNum v={data?.symbols?.length ?? 0} />
        </div>
      </div>

      {data?.actions && Object.keys(data.actions).length > 0 && (
        <section className="panel">
          <h2>动作分布</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>动作</th>
                <th>次数</th>
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
        <h2>符号命中 TopN</h2>
        {data?.symbols && data.symbols.length > 0 ? (
          <table className="grid">
            <thead>
              <tr>
                <th>符号</th>
                <th>命中次数</th>
                <th>权重</th>
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
          <p className="empty">暂无符号数据。</p>
        )}
      </section>

      <p className="hint">
        rspamd WebUI 深度配置后续经 Caddy 反代 /rspamd（compose 已预留，M4 接线）。
      </p>
    </main>
  )
}
