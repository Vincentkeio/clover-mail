'use client'

import { useCallback, useEffect, useState } from 'react'

type Cred = { id: string; name: string; deviceType: string | null; createdAt: string }

export default function PasskeySection({ count, demoMode }: { count: number; demoMode: boolean }) {
  const [creds, setCreds] = useState<Cred[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/v1/auth/webauthn/credentials')
    if (res.ok) setCreds(await res.json())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function register() {
    setBusy(true)
    setMsg(null)
    try {
      const { startRegistration } = await import('@simplewebauthn/browser')
      const optRes = await fetch('/api/v1/auth/webauthn/register/options', { method: 'POST' })
      if (!optRes.ok) {
        const d = await optRes.json().catch(() => ({}))
        setMsg({ ok: false, text: d.error ?? `获取注册选项失败（${optRes.status}）` })
        return
      }
      const options = await optRes.json()
      const attResp = await startRegistration({ optionsJSON: options })
      const verifyRes = await fetch('/api/v1/auth/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: attResp, name }),
      })
      const data = await verifyRes.json().catch(() => ({}))
      if (!verifyRes.ok) {
        setMsg({ ok: false, text: data.error ?? `注册失败（${verifyRes.status}）` })
        return
      }
      setName('')
      setMsg({ ok: true, text: 'Passkey 已添加，下次可用它一键登录（也可继续用密码 + TOTP）' })
      await load()
    } catch (err) {
      setMsg({ ok: false, text: `已取消或浏览器不支持：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('删除这个 Passkey？')) return
    setBusy(true)
    const res = await fetch(`/api/v1/auth/webauthn/credentials?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) {
      setMsg({ ok: true, text: '已删除' })
      await load()
    } else {
      const d = await res.json().catch(() => ({}))
      setMsg({ ok: false, text: d.error ?? '删除失败' })
    }
  }

  return (
    <section className="panel">
      <div className="section-title">
        <h2>Passkey（WebAuthn）</h2>
        <span className={'tag ' + (creds.length > 0 ? 'ok' : '')}>
          {creds.length > 0 ? `${creds.length} 个` : '未注册'}
        </span>
      </div>
      <p className="hint">
        用系统指纹/面容/安全密钥一键登录，抗钓鱼。需要 HTTPS 或 localhost（浏览器对 WebAuthn 的要求）。
        {demoMode && ' 演示模式下不可用。'}
      </p>

      {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}

      <div className="form-row">
        <div className="field">
          <label>设备昵称（可选）</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="MacBook Touch ID" />
        </div>
        <button className="primary" onClick={register} disabled={busy || demoMode} type="button">
          {busy ? '处理中…' : '添加 Passkey'}
        </button>
      </div>

      {creds.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>昵称</th>
              <th>类型</th>
              <th>注册时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {creds.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="hint-text">{c.deviceType ?? '—'}</td>
                <td className="hint-text">{new Date(c.createdAt).toLocaleString('zh-CN')}</td>
                <td>
                  <button className="danger" onClick={() => remove(c.id)} disabled={busy} type="button">
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {count > 0 && creds.length === 0 && <p className="empty">已注册 {count} 个（列表加载中或已过期）</p>}
    </section>
  )
}
