'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

type Cred = { id: string; name: string; deviceType: string | null; createdAt: string }

export default function PasskeySection({ count, demoMode }: { count: number; demoMode: boolean }) {
  const { t, dateLocale } = useI18n()
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
        setMsg({ ok: false, text: d.error ?? t('settings.registerOptionsFailed', { status: optRes.status }) })
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
        setMsg({ ok: false, text: data.error ?? t('settings.registerFailed', { status: verifyRes.status }) })
        return
      }
      setName('')
      setMsg({ ok: true, text: t('settings.passkeyAdded') })
      await load()
    } catch (err) {
      setMsg({ ok: false, text: t('settings.passkeyCancelled', { message: err instanceof Error ? err.message : String(err) }) })
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('settings.removePasskeyConfirm'))) return
    setBusy(true)
    const res = await fetch(`/api/v1/auth/webauthn/credentials?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) {
      setMsg({ ok: true, text: t('common.deleted') })
      await load()
    } else {
      const d = await res.json().catch(() => ({}))
      setMsg({ ok: false, text: d.error ?? t('settings.deleteFailed') })
    }
  }

  return (
    <section className="panel">
      <div className="section-title">
        <h2>{t('settings.passkeyTitle')}</h2>
        <span className={'tag ' + (creds.length > 0 ? 'ok' : '')}>
          {creds.length > 0 ? t('settings.passkeyCount', { count: creds.length }) : t('settings.passkeyNone')}
        </span>
      </div>
      <p className="hint">
        {t('settings.passkeyHint')}
        {demoMode && t('settings.passkeyDemoUnavailable')}
      </p>

      {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}

      <div className="form-row">
        <div className="field">
          <label>{t('settings.deviceNameLabel')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="MacBook Touch ID" />
        </div>
        <button className="primary" onClick={register} disabled={busy || demoMode} type="button">
          {busy ? t('settings.processing') : t('settings.addPasskey')}
        </button>
      </div>

      {creds.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>{t('settings.colNickname')}</th>
              <th>{t('settings.colType')}</th>
              <th>{t('settings.colRegisteredAt')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {creds.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="hint-text">{c.deviceType ?? '—'}</td>
                <td className="hint-text">{new Date(c.createdAt).toLocaleString(dateLocale)}</td>
                <td>
                  <button className="danger" onClick={() => remove(c.id)} disabled={busy} type="button">
                    {t('common.delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {count > 0 && creds.length === 0 && <p className="empty">{t('settings.credsStale', { count })}</p>}
    </section>
  )
}
