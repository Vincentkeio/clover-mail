'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function DomainCreateForm({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/v1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? `失败（${res.status}）` })
      return
    }
    setName('')
    setMsg({
      ok: true,
      text: data.dmsSynced
        ? `已创建并同步 DMS：${data.name}`
        : `已入库：${data.name}；DMS 同步失败，将由每日对账兜底`,
    })
    onCreated?.()
    router.refresh()
  }

  return (
    <form className="form-row" onSubmit={onSubmit}>
      <div className="field">
        <label>域名</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="example.com"
          required
        />
      </div>
      <button className="primary" disabled={busy}>
        {busy ? '提交中…' : '添加域名'}
      </button>
      {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
    </form>
  )
}
