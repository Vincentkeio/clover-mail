'use client'

import { useCallback, useEffect, useState } from 'react'

type GeneratedRecord = { type: string; name: string; content: string; ttl: number; priority?: number; cloverTag: string; purpose: string }
type CheckItem = { key: string; label: string; ok: boolean; expected: string; actual: string }
type PushResult = { noop?: boolean; posted?: number; patched?: number; deleted?: number; changes?: { added: string[]; updated: string[]; deleted: string[] }; check?: { passed: number; total: number; attempts?: number } }
type DnsData = {
  domain: { id: number; name: string; mailHostname: string | null }
  records: Array<{ id: number; type: string; name: string; content: string; status: string; comment: string | null }>
  generated: GeneratedRecord[]
  checklist: { items: CheckItem[]; checkedAt: string } | null
  settings: { vpsIp: string; dmarcPolicy: string; spfStrict: boolean; advancedDns: boolean }
}

export default function DnsPanel({ domainId, domainName }: { domainId: number; domainName: string }) {
  const [data, setData] = useState<DnsData | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const load = useCallback(async () => { const res = await fetch(`/api/v1/domains/${domainId}/dns`); if (res.ok) setData(await res.json()) }, [domainId])
  useEffect(() => { void load() }, [load])

  async function post(action: 'generate' | 'push' | 'check') {
    const url = `/api/v1/domains/${domainId}/dns${action === 'generate' ? '' : `/${action}`}`
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    const result = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(result.error ?? `请求失败（${res.status}）`)
    return result
  }
  async function syncToCloudflare() {
    setBusy('sync'); setMsg(null)
    try {
      await post('generate')
      const result = await post('push') as PushResult
      const summary = result.noop ? 'Cloudflare 记录已是最新。' : `已同步到 Cloudflare：新增 ${result.posted ?? 0} · 更新 ${result.patched ?? 0} · 清理 ${result.deleted ?? 0}`
      const updated = result.changes?.updated.length ? ` 更新项：${result.changes.updated.join('、')}。` : ''
      const checked = result.check
        ? result.check.passed === result.check.total
          ? ` 公网 DNS 检查 ${result.check.passed}/${result.check.total} 项通过。`
          : ` Cloudflare 已完成记录同步；公网 DNS 检查 ${result.check.passed}/${result.check.total} 项通过。解析器可能仍缓存旧结果，请稍后点“重新检测 DNS”，无需再次推送。`
        : ' 未能检查公网 DNS，请确认已设置 VPS IP。'
      setMsg({ ok: true, text: `${summary}${updated}${checked}` })
      await load()
    } catch (error) { setMsg({ ok: false, text: String(error) }) }
    finally { setBusy(null) }
  }
  async function act(action: 'generate' | 'check') {
    setBusy(action); setMsg(null)
    try {
      const result = await post(action)
      if (action === 'check') { const passed = (result.items ?? []).filter((item: CheckItem) => item.ok).length; setMsg({ ok: true, text: `检测完成：${passed}/${(result.items ?? []).length} 项通过。` }) }
      else setMsg({ ok: true, text: `已生成 ${result.count ?? 0} 条记录。` })
      await load()
    } catch (error) { setMsg({ ok: false, text: String(error) }) }
    finally { setBusy(null) }
  }
  if (!data) return <section className="panel"><h2>DNS 配置</h2><p className="empty">正在读取 DNS 状态…</p></section>

  const dkimMissing = !data.generated.some((record) => record.cloverTag === 'clover-dkim')
  const items = data.checklist?.items ?? []
  const pushed = data.records.filter((record) => record.status === 'pushed').length
  return <div className="dns-panel-stack">
    <section className="panel dns-primary-panel">
      <div className="dns-primary-copy"><div className="eyebrow"><span className="status-dot"/>Cloudflare · 推荐</div><h2>配置邮件 DNS</h2><p className="hint">按当前域名和邮件服务器设置生成所需记录，并安全同步到 Cloudflare。可重复执行。</p></div>
      <div className="dns-primary-actions"><button className="primary dns-primary-button" type="button" onClick={syncToCloudflare} disabled={busy !== null}>{busy === 'sync' ? '正在生成并同步…' : '推送到 Cloudflare'}<span aria-hidden="true">→</span></button><span className="hint-text">{data.generated.length} 条记录 · {pushed} 条已推送</span></div>
      {msg && <div role="status" className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
      {items.length > 0 && <div className="dns-check-summary"><div className="section-title"><h3>生效状态</h3><span className="count">{items.filter((item) => item.ok).length}/{items.length} 项通过</span></div><div className="checklist-row">{items.map((item) => <span key={item.key} className={'tag ' + (item.ok ? 'ok' : 'warn')}>{item.ok ? '✓' : '·'} {item.label}</span>)}</div></div>}
    </section>
    <details className="advanced-details dns-advanced"><summary>高级选项 <span>手动导入、记录预览与 DNS 检查</span></summary><div className="advanced-body">
      <div className="advanced-actions"><button type="button" disabled={busy !== null} onClick={() => act('generate')}>{busy === 'generate' ? '生成中…' : '仅重新生成记录'}</button><button type="button" disabled={busy !== null} onClick={() => act('check')}>{busy === 'check' ? '检测中…' : '重新检测 DNS'}</button><a className="btn-link" href={`/api/v1/domains/${domainId}/dns/export?format=bind`}>导出 BIND 文件</a><a className="btn-link" href={`/api/v1/domains/${domainId}/dns/export?format=text`}>导出文本清单</a></div>
      <p className="hint">适用于自行管理 DNS 的服务商。导入文件后可重新检测解析结果。</p>
      {dkimMissing && <p className="hint warning-copy">未读到该域名的 DKIM 公钥。确认邮件服务已启动后重新生成即可；DKIM 不依赖已创建邮箱。</p>}
      <div className="section-title"><h3>记录预览</h3><span className="count">VPS IP {data.settings.vpsIp || '未设置'} · DMARC {data.settings.dmarcPolicy}</span></div>
      <div className="table-scroll"><table className="grid"><thead><tr><th>类型</th><th>名称</th><th>内容</th><th>用途</th><th>状态</th></tr></thead><tbody>{data.generated.map((record) => { const stored = data.records.find((item) => item.type === record.type && item.name === record.name && item.comment === record.cloverTag); return <tr key={record.cloverTag}><td>{record.type}</td><td className="mono">{record.name === '@' ? domainName : `${record.name}.${domainName}`}</td><td className="mono record-content">{record.content}</td><td>{record.purpose}</td><td><span className={'tag ' + (stored?.status === 'pushed' ? 'ok' : '')}>{stored?.status === 'pushed' ? '已推送' : '待推送'}</span></td></tr> })}</tbody></table></div>
      {items.length > 0 && <><div className="section-title detail-check-title"><h3>DNS 检测明细</h3><span className="count">{data.checklist?.checkedAt ? `检测于 ${new Date(data.checklist.checkedAt).toLocaleString('zh-CN')}` : ''}</span></div><div className="table-scroll"><table className="grid"><thead><tr><th>项目</th><th>结果</th><th>期望</th><th>实际</th></tr></thead><tbody>{items.map((item) => <tr key={item.key}><td>{item.label}</td><td><span className={'tag ' + (item.ok ? 'ok' : 'err')}>{item.ok ? '通过' : '未通过'}</span></td><td className="mono record-content">{item.expected || '—'}</td><td className="mono record-content">{item.actual || '(空)'}</td></tr>)}</tbody></table></div></>}
    </div></details>
  </div>
}
