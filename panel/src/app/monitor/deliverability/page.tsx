'use client'

import { useState } from 'react'

type DnsblResult = { zone: string; label: string; listed: boolean; detail?: string; error?: string }
type HealthItem = { key: string; label: string; ok: boolean; detail: string }
type Result = {
  ip: string | null
  domain: string | null
  dnsbl: { ip: string; results: DnsblResult[]; reachable: boolean } | null
  health: { domain: string; mailHostname: string; items: HealthItem[] } | null
}

export default function DeliverabilityPage() {
  const [data, setData] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/v1/system/deliverability')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(body.error ?? `失败（${res.status}）`)
        return
      }
      setData(body)
      const listed = body.dnsbl?.results?.filter((r: DnsblResult) => r.listed).length ?? 0
      const failed = body.health?.items?.filter((i: HealthItem) => !i.ok).length ?? 0
      setMsg(
        `体检完成：黑名单命中 ${listed} 家，域健康未过 ${failed} 项` +
          (!body.dnsbl?.reachable ? '（黑名单查询网络不可达）' : ''),
      )
    } finally {
      setBusy(false)
    }
  }

  const listed = data?.dnsbl?.results?.filter((r) => r.listed) ?? []

  return (
    <main className="wrap">
      <div className="topbar">
        <span className="logo">🍀</span>
        <h1>投递体检</h1>
        <span className="tag">DNSBL + 域健康</span>
      </div>

      <div className="form-row">
        <button className="primary" onClick={run} disabled={busy} type="button">
          {busy ? '查询中…' : '开始体检'}
        </button>
        {msg && <div className="msg ok" style={{ flexBasis: '100%' }}>{msg}</div>}
      </div>

      <p className="hint">
        黑名单用标准 DNSBL 协议查询（反转 IP + A 记录，127.0.0.2 表示命中），无需 MXToolbox key；
        命中后去各 DNSBL 官网按指引移除。IP 取设置页的 VPS IP。
      </p>

      {data?.dnsbl && (
        <section className="panel">
          <h2>IP 黑名单（{data.dnsbl.ip}）</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>名单</th>
                <th>结果</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {data.dnsbl.results.map((r) => (
                <tr key={r.zone}>
                  <td>{r.label}</td>
                  <td>
                    {r.error ? (
                      <span className="tag warn">查询失败</span>
                    ) : r.listed ? (
                      <span className="tag err">已命中</span>
                    ) : (
                      <span className="tag ok">干净</span>
                    )}
                  </td>
                  <td className="mono hint-text">{r.detail ?? r.error ?? '未收录'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {listed.length === 0 && !data.dnsbl.results.some((r) => r.error) && (
            <p className="msg ok">IP 在 5 家主流 DNSBL 均为干净。</p>
          )}
        </section>
      )}

      {data?.health && (
        <section className="panel">
          <h2>域健康（{data.health.domain}）</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>检查项</th>
                <th>结果</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {data.health.items.map((i) => (
                <tr key={i.key}>
                  <td>{i.label}</td>
                  <td>
                    <span className={'tag ' + (i.ok ? 'ok' : 'err')}>{i.ok ? '通过' : '未通过'}</span>
                  </td>
                  <td className="mono hint-text" style={{ wordBreak: 'break-all' }}>
                    {i.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="hint">
        相关：<a href="/monitor/spam">反垃圾监控</a> · <a href="/monitor/queue">队列与日志</a>
      </p>
    </main>
  )
}
