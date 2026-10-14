'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { MATCH_LABELS } from './mailbox-form'

const TYPES = ['exact', 'prefix', 'nonuser', 'catchall'] as const

export default function RuleForm({ domainId, domainName }: { domainId: number; domainName: string }) {
  const router = useRouter()
  const [matchType, setMatchType] = useState<(typeof TYPES)[number]>('exact')
  const [matchValue, setMatchValue] = useState('')
  const [targets, setTargets] = useState('')
  const [priority, setPriority] = useState('100')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const needValue = matchType !== 'catchall'

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await fetch(`/api/v1/domains/${domainId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchType,
        matchValue: needValue ? matchValue : undefined,
        targets,
        priority: Number(priority),
      }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? `失败（${res.status}）` })
      return
    }
    setMatchValue('')
    setTargets('')
    const note = data.dmsSupported
      ? data.dmsSynced
        ? '已创建并同步 DMS alias'
        : '已入库；DMS alias 同步失败，对账兜底'
      : '已入库（前缀规则暂存面板，DMS 下发留待 M3）'
    setMsg({ ok: true, text: `${note}：${data.matchType}${data.matchValue ? ' ' + data.matchValue : ''}` })
    router.refresh()
  }

  return (
    <form className="form-row" onSubmit={onSubmit}>
      <div className="field">
        <label>规则类型</label>
        <select value={matchType} onChange={(e) => setMatchType(e.target.value as (typeof TYPES)[number])}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {MATCH_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      {needValue && (
        <div className="field">
          <label>匹配值</label>
          <input
            value={matchValue}
            onChange={(e) => setMatchValue(e.target.value)}
            placeholder={matchType === 'prefix' ? 'sales' : `sales@${domainName}`}
            required
          />
        </div>
      )}
      <div className="field">
        <label>转发目标（逗号分隔，可多个）</label>
        <input value={targets} onChange={(e) => setTargets(e.target.value)} placeholder="me@gmail.com, boss@qq.com" required />
      </div>
      <div className="field">
        <label>优先级（小者先）</label>
        <input value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric" />
      </div>
      <button className="primary" disabled={busy}>
        {busy ? '提交中…' : '添加规则'}
      </button>
      {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
    </form>
  )
}
