'use client'

import { useCallback, useEffect, useState } from 'react'

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
  const [data, setData] = useState<DnsData | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const load = useCallback(async () => { const res = await fetch(`/api/v1/domains/${domainId}/dns`, { cache: 'no-store' }); if (res.ok) setData(await res.json()) }, [domainId])
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
      const summary = result.noop ? 'Cloudflare 记录已是最新。' : `同步完成：新增 ${result.posted ?? 0}、更新 ${result.patched ?? 0}、清理 ${result.deleted ?? 0}。`
      const checked = result.check ? ` DNS ${result.check.passed}/${result.check.total} 项匹配。` : ''
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
      if (action === 'check') { const passed = (result.items ?? []).filter((item: CheckItem) => item.ok).length; setMsg({ ok: true, text: `DNS 记录检查完成：${passed}/${(result.items ?? []).length} 项匹配。` }) }
      else setMsg({ ok: true, text: `已生成 ${result.count ?? 0} 条记录。` })
      await load()
    } catch (error) { setMsg({ ok: false, text: String(error) }) }
    finally { setBusy(null) }
  }
  if (!data) return <p className="dns-panel-loading" role="status">正在读取 DNS 配置…</p>

  const dkimMissing = !data.generated.some((record) => record.cloverTag === 'clover-dkim')
  const items = data.checklist?.items ?? []
  const pushed = data.records.filter((record) => record.status === 'pushed').length
  return <div className="dns-panel-stack">
    {view === 'automatic' && <section className="dns-auto-sync">
      <div className="dns-auto-sync-copy"><p className="eyebrow"><span className="status-dot"/>Cloudflare</p><p>按当前邮件设置生成 DNS 记录并同步。</p></div>
      <div className="dns-auto-sync-action"><span>{data.generated.length} 条记录 · {pushed} 条已推送</span><button className="primary" type="button" onClick={syncToCloudflare} disabled={busy !== null}>{busy === 'sync' ? '正在同步…' : '推送到 Cloudflare'}<span aria-hidden="true">→</span></button></div>
      {msg && <div role="status" className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
    </section>}
    {view === 'advanced' && <section className="advanced-body dns-advanced-content">
      <div className="advanced-actions"><button type="button" disabled={busy !== null} onClick={() => act('generate')}>{busy === 'generate' ? '生成中…' : '仅重新生成记录'}</button><a className="btn-link" href={`/api/v1/domains/${domainId}/dns/export?format=bind`}>导出 BIND 文件</a><a className="btn-link" href={`/api/v1/domains/${domainId}/dns/export?format=text`}>导出 TXT 文件</a></div>
      <p className="hint">适用于自行管理 DNS 的服务商。导入文件后可重新检测解析结果。</p>
      {dkimMissing && <p className="hint warning-copy">未读到该域名的 DKIM 公钥。确认邮件服务已启动后重新生成即可；DKIM 不依赖已创建邮箱。</p>}
      <div className="section-title"><h3>记录预览</h3><span className="count">VPS IP {data.settings.vpsIp || '未设置'} · DMARC {data.settings.dmarcPolicy}</span></div>
      <div className="table-scroll"><table className="grid"><thead><tr><th>类型</th><th>名称</th><th>内容</th><th>用途</th><th>状态</th></tr></thead><tbody>{data.generated.map((record) => {
        const stored = data.records.find((item) => item.type === record.type && item.name === record.name && item.comment === record.cloverTag)
        const check = items.find((item) => item.key === RECORD_CHECK_KEYS[record.cloverTag])
        const status = check?.ok ? { label: 'DNS 匹配', tone: 'ok' } : check ? { label: '未匹配', tone: 'warn' } : { label: stored?.status === 'pushed' ? '已推送' : '未检测', tone: '' }
        return <tr key={record.cloverTag}><td>{record.type}</td><td className="mono">{record.name === '@' ? domainName : `${record.name}.${domainName}`}</td><td className="mono record-content">{record.content}</td><td>{record.purpose}</td><td><span className={'tag ' + status.tone}>{status.label}</span></td></tr>
      })}</tbody></table></div>
      {items.length > 0 && <><div className="section-title detail-check-title"><h3>DNS 检测明细</h3><span className="count">{data.checklist?.checkedAt ? `检测于 ${new Date(data.checklist.checkedAt).toLocaleString('zh-CN')}` : ''}</span></div><div className="table-scroll"><table className="grid"><thead><tr><th>项目</th><th>结果</th><th>期望</th><th>实际</th></tr></thead><tbody>{items.map((item) => <tr key={item.key}><td>{item.label}</td><td><span className={'tag ' + (item.ok ? 'ok' : 'err')}>{item.ok ? 'DNS 匹配' : '未匹配'}</span></td><td className="mono record-content">{item.expected || '—'}</td><td className="mono record-content">{item.actual || '(空)'}</td></tr>)}</tbody></table></div></>}
    </section>}
    {view === 'manual' && <section className="panel dns-manual-reference"><p className="hint">将下列记录添加到 <b className="mono">{domainName}</b> 所使用的 DNS 服务商。名称和值按当前邮件主机与服务器设置实时生成。</p><div className="table-scroll"><table className="grid"><thead><tr><th>类型</th><th>名称</th><th>记录值</th><th>优先级</th><th>TTL</th><th>用途</th></tr></thead><tbody>{data.generated.map((record) => <tr key={record.cloverTag}><td>{record.type}</td><td className="mono">{record.name === '@' ? domainName : `${record.name}.${domainName}`}</td><td className="mono record-content">{record.content}</td><td>{record.priority ?? '—'}</td><td>{record.ttl}</td><td>{record.purpose}</td></tr>)}</tbody></table></div><div className="dns-manual-note"><b>配置后</b><span>等待 DNS 生效，再回到“自动配置 DNS”选择该域名并点“检查 DNS”。手动配置不会自动同步到 Cloudflare。</span></div></section>}
  </div>
}
