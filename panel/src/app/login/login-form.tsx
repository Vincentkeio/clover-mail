'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function LoginForm({ error, created, needsAdmin = false }: { error?: string; created?: string; needsAdmin?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(
    needsAdmin ? null : error && error !== 'totp_required' ? '用户名或密码错误' : created ? '管理员已创建，请登录' : null,
  )
  const [needTotp, setNeedTotp] = useState(error === 'totp_required')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, totp }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)

    if (res.ok) {
      router.replace('/')
      router.refresh()
      return
    }
    if (data.error === 'totp_required') {
      setNeedTotp(true)
      setMsg('请输入两步验证码')
      return
    }
    if (data.error === 'invalid_totp') {
      setNeedTotp(true)
      setTotp('')
      setMsg('验证码不正确或已过期，请重试')
      return
    }
    setMsg('用户名或密码错误')
  }

  async function passkeyLogin() {
    setBusy(true)
    setMsg(null)
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser')
      const optRes = await fetch('/api/auth/webauthn/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      if (!optRes.ok) {
        const d = await optRes.json().catch(() => ({}))
        setMsg(d.error ?? '该账号未注册 Passkey')
        return
      }
      const options = await optRes.json()
      const assertion = await startAuthentication({ optionsJSON: options })
      const verifyRes = await fetch('/api/auth/webauthn/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, response: assertion }),
      })
      if (!verifyRes.ok) {
        const d = await verifyRes.json().catch(() => ({}))
        setMsg(d.error ?? 'Passkey 登录失败')
        return
      }
      router.replace('/')
      router.refresh()
    } catch (err) {
      setMsg(`Passkey 登录中断：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-logo"><img src="/clover-mark.svg" alt="" /></div>
      <h1>clover 三叶草邮局</h1>
      {needsAdmin ? (
        <p className="login-hint">尚未创建管理员。请通过 SSH 登录服务器并运行 <code>clover admin create</code>，然后返回此页登录。</p>
      ) : (
        <>
          {msg && <p className="login-err">{msg}</p>}
          <label>
            用户名
            <input
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {needTotp && (
            <label>
              两步验证码
              <input
                name="totp"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                maxLength={6}
                autoFocus
              />
            </label>
          )}
          <button type="submit" disabled={busy || (needTotp && totp.length !== 6)}>
            {busy ? '登录中…' : '登 录'}
          </button>
          <button type="button" className="link-btn" onClick={passkeyLogin} disabled={busy || !username}>
            用 Passkey 登录
          </button>
        </>
      )}
    </form>
  )
}
