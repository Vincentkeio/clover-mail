'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

export default function LoginForm({ error, created, needsAdmin = false }: { error?: string; created?: string; needsAdmin?: boolean }) {
  const router = useRouter()
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(
    needsAdmin ? null : error && error !== 'totp_required' ? t('login.invalidCredentials') : created ? t('login.adminCreated') : null,
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
      setMsg(t('login.totpRequired'))
      return
    }
    if (data.error === 'invalid_totp') {
      setNeedTotp(true)
      setTotp('')
      setMsg(t('login.invalidTotp'))
      return
    }
    setMsg(t(data.error === 'too_many_attempts' ? 'login.tooManyAttempts' : 'login.invalidCredentials'))
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
        setMsg(d.error === 'too_many_attempts' ? t('login.tooManyAttempts') : d.error ?? t('login.passkeyNotRegistered'))
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
        setMsg(d.error ?? t('login.passkeyFailed'))
        return
      }
      router.replace('/')
      router.refresh()
    } catch (err) {
      setMsg(t('login.passkeyInterrupted', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-logo"><img src="/clover-mark.svg" alt="" /></div>
      <h1>{t('common.appTitle')}</h1>
      {needsAdmin ? (
        <p className="login-hint">{t('login.noAdminLead')} <code>clover admin create</code>{t('login.noAdminTail')}</p>
      ) : (
        <>
          {msg && <p className="login-err">{msg}</p>}
          <label>
            {t('login.username')}
            <input
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            {t('common.password')}
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
              {t('login.totpLabel')}
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
            {busy ? t('login.signingIn') : t('login.submit')}
          </button>
          <button type="button" className="link-btn" onClick={passkeyLogin} disabled={busy || !username}>
            {t('login.passkeySubmit')}
          </button>
        </>
      )}
    </form>
  )
}
