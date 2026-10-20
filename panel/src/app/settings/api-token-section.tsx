'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

type TokenRow = {
  id: number
  name: string
  prefix: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export default function ApiTokenSection({ demoMode }: { demoMode: boolean }) {
  const { t, dateLocale } = useI18n()
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
      setMsg({ ok: false, text: data.error ?? t('settings.failedStatus', { status: res.status }) })
      return
    }
    setCreated(data.token)
    setName('')
    await load()
  }

  async function revoke(id: number, tokenName: string) {
    if (!window.confirm(t('settings.revokeConfirm', { name: tokenName }))) return
    setBusy(true)
    const res = await fetch(`/api/v1/system/tokens?id=${id}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) {
      setMsg({ ok: true, text: t('settings.revoked') })
      await load()
    } else {
      const d = await res.json().catch(() => ({}))
      setMsg({ ok: false, text: d.error ?? t('settings.revokeFailed') })
    }
  }

  return (
    <section className="panel">
      <div className="section-title">
        <h2>{t('settings.apiTokenTitle')}</h2>
        <span className="count">
          {t('settings.tokenCount', { count: rows.filter((r) => !r.revokedAt).length })}<a href="/api-docs">{t('settings.tokenDocs')}</a>
        </span>
      </div>
      <p className="hint">
        {t('settings.tokenHintPrefix')}<span className="mono">Authorization: Bearer clover_…</span>{t('settings.tokenHintSuffix')}
      </p>

      {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}

      <div className="form-row">
        <div className="field">
          <label>{t('settings.tokenNameLabel')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="backup-cron" />
        </div>
        <button className="primary" onClick={create} disabled={busy || !name.trim() || demoMode} type="button">
          {busy ? t('settings.generating') : t('settings.createToken')}
        </button>
        {demoMode && <span className="hint-text">{t('settings.demoCannotCreate')}</span>}
      </div>

      {created && (
        <div className="banner" style={{ borderColor: '#e0b400' }}>
          <b>{t('settings.tokenOnce')}</b>
          <p className="mono" style={{ wordBreak: 'break-all', margin: '8px 0 0' }}>
            {created}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('settings.colPrefix')}</th>
              <th>{t('settings.colLastUsed')}</th>
              <th>{t('common.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="mono">{r.prefix}</td>
                <td className="hint-text">
                  {r.lastUsedAt ? new Date(r.lastUsedAt).toLocaleString(dateLocale) : t('settings.neverUsed')}
                </td>
                <td>
                  <span className={'tag ' + (r.revokedAt ? 'err' : 'ok')}>{r.revokedAt ? t('settings.revoked') : t('settings.tokenActive')}</span>
                </td>
                <td>
                  {!r.revokedAt && (
                    <button className="danger" onClick={() => revoke(r.id, r.name)} disabled={busy} type="button">
                      {t('settings.revoke')}
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
