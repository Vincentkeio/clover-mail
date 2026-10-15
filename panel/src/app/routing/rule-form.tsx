'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const TYPES = ['exact', 'prefix', 'nonuser', 'catchall'] as const
const MATCH_LABELS: Record<string, string> = {
  exact: '精确地址（如 sales@example.com）',
  prefix: '前缀匹配（如 sales → sales*@example.com）',
  nonuser: '非用户地址（等同精确，语义标记用）',
  catchall: 'Catch-all 捕获此域一切来信',
}

export default function RuleForm({ domainId, domainName }: { domainId: number; domainName: string }) {
  const router = useRouter()
  const [matchType, setMatchType] = useState<(typeof TYPES)[number]>('exact')
  const [matchValue, setMatchValue] = useState('')
  const [targets, setTargets] = useState('')
  const [priority, setPriority] = useState('100')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const needValue = matchType !== 'catchall'

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMsg(null)
    const response = await fetch(`/api/v1/domains/${domainId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchType, matchValue: needValue ? matchValue : undefined, targets, priority: Number(priority) }),
    })
    const data = await response.json().catch(() => ({}))
    setBusy(false)
    if (!response.ok) {
      setMsg({ ok: false, text: data.error ?? `失败（${response.status}）` })
      return
    }
    setMatchValue('')
    setTargets('')
    const note = data.matchType === 'prefix'
      ? data.prefixSynced ? '已创建并应用邮件服务' : '已保存；前缀规则未能同步到邮件服务'
      : data.dmsSynced ? '已创建并同步邮件服务' : '已保存；邮件服务同步失败，将由对账兜底'
    setMsg({ ok: true, text: `${note}：${data.matchType}${data.matchValue ? ` ${data.matchValue}` : ''}` })
    router.refresh()
  }

  return <form className="form-row" onSubmit={onSubmit}>
    <div className="field"><label htmlFor="routing-match-type">规则类型</label><select id="routing-match-type" value={matchType} onChange={(event) => setMatchType(event.target.value as (typeof TYPES)[number])}>{TYPES.map((type) => <option key={type} value={type}>{MATCH_LABELS[type]}</option>)}</select></div>
    {needValue && <div className="field"><label htmlFor="routing-match-value">匹配地址</label><input id="routing-match-value" value={matchValue} onChange={(event) => setMatchValue(event.target.value)} placeholder={matchType === 'prefix' ? 'sales' : `sales@${domainName}`} required /></div>}
    <div className="field"><label htmlFor="routing-targets">转发目标（逗号分隔，可多个）</label><input id="routing-targets" value={targets} onChange={(event) => setTargets(event.target.value)} placeholder="me@gmail.com, boss@qq.com" required /></div>
    <div className="field"><label htmlFor="routing-priority">优先级（小者先）</label><input id="routing-priority" value={priority} onChange={(event) => setPriority(event.target.value)} inputMode="numeric" /></div>
    <button className="primary" disabled={busy}>{busy ? '提交中…' : '添加规则'}</button>
    {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.text}</div>}
  </form>
}
