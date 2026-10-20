'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/lib/i18n/client'

type SetupData = { secret: string; uri: string; qr: string; issuer: string; username: string }

export default function TotpSection({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const { t } = useI18n()
  const [setup, setSetup] = useState<SetupData | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function startSetup() {
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/v1/auth/totp', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? t('settings.failedStatus', { status: res.status }) })
      return
    }
    setSetup(data)
  }

  async function confirmEnable() {
    if (!setup) return
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/v1/auth/totp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: setup.secret, code }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? t('settings.failedStatus', { status: res.status }) })
      return
    }
    setSetup(null)
    setCode('')
    setMsg({ ok: true, text: t('settings.totpEnabled') })
    router.refresh()
  }

  async function disable() {
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/v1/auth/totp', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setCode('')
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? t('settings.failedStatus', { status: res.status }) })
      return
    }
    setMsg({ ok: true, text: t('settings.totpDisabled') })
    router.refresh()
  }

  return (
    <section className="panel">
      <div className="section-title">
        <h2>{t('settings.totpTitle')}</h2>
        <span className={'tag ' + (enabled ? 'ok' : '')}>{enabled ? t('settings.stateOn') : t('settings.stateOff')}</span>
      </div>
      <p className="hint">
        {t('settings.totpHint')}
      </p>

      {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}

      {!enabled && !setup && (
        <div className="form-row">
          <button className="primary" onClick={startSetup} disabled={busy} type="button">
            {busy ? t('settings.generating') : t('settings.enableTotp')}
          </button>
        </div>
      )}

      {!enabled && setup && (
        <>
          <div className="totp-setup">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt={t('settings.qrAlt')} width={200} height={200} />
            <div>
              <p className="hint">
                {t('settings.manualAddPrefix')}<b>{setup.username}</b>{t('settings.manualAddSuffix')}
              </p>
              <p className="mono" style={{ wordBreak: 'break-all' }}>
                {setup.secret}
              </p>
              <div className="form-row">
                <div className="field">
                  <label>{t('settings.codeLabel')}</label>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    inputMode="numeric"
                    maxLength={6}
                  />
                </div>
                <button className="primary" onClick={confirmEnable} disabled={busy || code.length !== 6} type="button">
                  {busy ? t('settings.verifying') : t('settings.confirmEnable')}
                </button>
                <button onClick={() => { setSetup(null); setCode(''); setMsg(null) }} type="button">
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {enabled && (
        <div className="form-row">
          <div className="field">
            <label>{t('settings.disableCodeLabel')}</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
              maxLength={6}
            />
          </div>
          <button className="danger" onClick={disable} disabled={busy || code.length !== 6} type="button">
            {busy ? t('settings.processing') : t('settings.disableTotp')}
          </button>
        </div>
      )}
    </section>
  )
}
