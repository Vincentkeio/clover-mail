'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const MATCH_LABELS: Record<string, string> = {
  exact: '精确地址（如 sales@example.com）',
  prefix: '前缀匹配（如 sales → sales*@example.com）',
  nonuser: '非用户地址（等同精确，语义标记用）',
  catchall: 'Catch-all 捕获此域一切来信',
}

export default function MailboxForm({ domainId, domainName }: { domainId: number; domainName: string }) {
  const router = useRouter()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [quota, setQuota] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await fetch(`/api/v1/domains/${domainId}/mailboxes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login,
        password,
        quotaMb: quota ? Number(quota) : undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? `失败（${res.status}）` })
      return
    }
    setLogin('')
    setPassword('')
    setQuota('')
    setMsg({
      ok: true,
      text: data.dmsSynced ? `已创建并同步 DMS：${data.login}` : `已入库：${data.login}；DMS 同步失败，对账兜底`,
    })
    router.refresh()
  }

  return (
    <form className="form-row" onSubmit={onSubmit}>
      <div className="field">
        <label>邮箱地址（@{domainName}）</label>
        <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder={`boss@${domainName}`} required />
      </div>
      <div className="field">
        <label>密码（至少 10 位）</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="new-password"
          required
        />
      </div>
      <div className="field">
        <label>配额 MB（可空）</label>
        <input value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="2048" inputMode="numeric" />
      </div>
      <button className="primary" disabled={busy}>
        {busy ? '提交中…' : '添加邮箱'}
      </button>
      {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
    </form>
  )
}

export { MATCH_LABELS }
