'use client'

import { useCallback, useEffect, useState } from 'react'

type TokenRow = {
  id: number
  name: string
  prefix: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export default function ApiTokenSection({ demoMode }: { demoMode: boolean }) {
  const [rows, setRows] = useState<TokenRow[]>([])
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/v1/system/tokens')
    if (res.ok) setRows(await res.json())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    setBusy(true)
    setMsg(null)
    setCreated(null)
    const res = await fetch('/api/v1/system/tokens', {
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
    setCreated(data.token)
    setName('')
    await load()
  }

  async function revoke(id: number, tokenName: string) {
    if (!window.confirm(`吊销 token「${tokenName}」？使用它的脚本会立即失效。`)) return
    setBusy(true)
    const res = await fetch(`/api/v1/system/tokens?id=${id}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) {
      setMsg({ ok: true, text: '已吊销' })
      await load()
    } else {
      const d = await res.json().catch(() => ({}))
      setMsg({ ok: false, text: d.error ?? '吊销失败' })
    }
  }

  return (
    <section className="panel">
      <div className="section-title">
        <h2>开放 API Token</h2>
        <span className="count">
          {rows.filter((r) => !r.revokedAt).length} 个有效 · <a href="/api-docs">查看端点文档 →</a>
        </span>
      </div>
      <p className="hint">
        用 <span className="mono">Authorization: Bearer clover_…</span> 调用全部 /api/v1 端点（面板即 API）。
        明文只在创建时显示一次，库里只存 sha256。
      </p>

      {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}

      <div className="form-row">
        <div className="field">
          <label>用途名称（如「CI 部署脚本」）</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="backup-cron" />
        </div>
        <button className="primary" onClick={create} disabled={busy || !name.trim() || demoMode} type="button">
          {busy ? '生成中…' : '生成 token'}
        </button>
        {demoMode && <span className="hint-text">演示模式下不可创建</span>}
      </div>

      {created && (
        <div className="banner" style={{ borderColor: '#e0b400' }}>
          <b>只显示这一次，请立即保存：</b>
          <p className="mono" style={{ wordBreak: 'break-all', margin: '8px 0 0' }}>
            {created}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>名称</th>
              <th>前缀</th>
              <th>最后使用</th>
              <th>状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="mono">{r.prefix}</td>
                <td className="hint-text">
                  {r.lastUsedAt ? new Date(r.lastUsedAt).toLocaleString('zh-CN') : '从未使用'}
                </td>
                <td>
                  <span className={'tag ' + (r.revokedAt ? 'err' : 'ok')}>{r.revokedAt ? '已吊销' : '有效'}</span>
                </td>
                <td>
                  {!r.revokedAt && (
                    <button className="danger" onClick={() => revoke(r.id, r.name)} disabled={busy} type="button">
                      吊销
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
