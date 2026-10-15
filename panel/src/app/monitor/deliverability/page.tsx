'use client'

import { useState } from 'react'
import type { DnsblResult } from '@/lib/dnsbl'

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
  const [messageTone, setMessageTone] = useState<'ok' | 'warn' | 'err'>('ok')

  async function run() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/v1/system/deliverability', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessageTone('err')
        setMsg(body.error ?? `失败（${res.status}）`)
        return
      }
      setData(body)
      const listed = body.dnsbl?.results?.filter((r: DnsblResult) => r.listed).length ?? 0
      const failed = body.health?.items?.filter((i: HealthItem) => !i.ok).length ?? 0
      const uncertain = body.dnsbl?.results?.filter((r: DnsblResult) => r.error).length ?? 0
      setMessageTone(listed || failed || uncertain ? 'warn' : 'ok')
      setMsg(
        `体检完成：黑名单命中 ${listed} 家，无法确定 ${uncertain} 家，域健康未过 ${failed} 项`,
      )
    } catch (error) {
      setMessageTone('err'); setMsg(error instanceof Error ? error.message : '体检查询失败，请重试。')
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
        {msg && <div className={'msg ' + messageTone} role="status" style={{ flexBasis: '100%' }}>{msg}</div>}
      </div>

      <p className="hint">
        使用 DNSBL 查询并按名单的有效返回码判断。查询受限或失败表示本次无法确定，不计为命中，也不计为未命中。
        IP 取设置页的 VPS IP；可到名单官网进一步核验。
      </p>

      {data?.dnsbl && (
        <section className="panel">
          <h2>IP 黑名单（{data.dnsbl.ip}）</h2>
          <div className="table-scroll"><table className="grid">
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
                      <span className="tag warn">{r.status === 'restricted' ? '查询受限' : '查询失败'}</span>
                    ) : r.listed ? (
                      <span className="tag err">已命中</span>
                    ) : (
                      <span className="tag ok">未命中</span>
                    )}
                  </td>
                  <td className="hint-text">{[r.detail, r.error].filter(Boolean).join('；') || '本次查询未命中'}{r.zone === 'zen.spamhaus.org' && r.error && <> <a href="https://check.spamhaus.org/" target="_blank" rel="noreferrer">官网核验 →</a></>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {listed.length === 0 && !data.dnsbl.results.some((r) => r.error) && (
            <p className="msg ok">本次查询的 {data.dnsbl.results.length} 家 DNSBL 均未命中。</p>
          )}
          <p className="hint">DNSBL 结果不代表 Gmail 的信誉评分，也不能保证邮件进入收件箱。</p>
        </section>
      )}

      {data?.health && (
        <section className="panel">
          <h2>域健康（{data.health.domain}）</h2>
          <div className="table-scroll"><table className="grid">
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
          </table></div>
        </section>
      )}

      <p className="hint">
        相关：<a href="/monitor/spam">反垃圾监控</a> · <a href="/monitor/queue">队列与日志</a>
      </p>
    </main>
  )
}
