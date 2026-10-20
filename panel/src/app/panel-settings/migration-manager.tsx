'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useI18n } from '@/lib/i18n/client'

type MigrationState = { state: string; message: string }

export default function MigrationManager() {
  const { t } = useI18n()
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function beginExport(event: FormEvent<HTMLFormElement>) {
    if (exportPassphrase.length < 12) {
      event.preventDefault()
      setMessage({ ok: false, text: t('panelSettings.passphraseTooShort') })
      return
    }
    setMessage({ ok: true, text: t('panelSettings.exportStarted') })
  }

  async function importBundle() {
    if (!file || busy) return
    if (confirmation !== 'RESTORE') {
      setMessage({ ok: false, text: t('panelSettings.restoreConfirmRequired') })
      return
    }
    if (importPassphrase.length < 12) {
      setMessage({ ok: false, text: t('panelSettings.passphraseRequired') })
      return
    }
    setBusy(true)
    setMessage({ ok: true, text: t('panelSettings.uploading') })
    try {
      const response = await fetch('/api/v1/system/migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.clover.migration', 'X-Clover-Migration-Passphrase': btoa(String.fromCharCode(...new TextEncoder().encode(importPassphrase))), 'X-Clover-Confirm': confirmation },
        body: file,
      })
      const result = await response.json() as { error?: string; job?: string; message?: string }
      if (!response.ok || !result.job) throw new Error(result.error || t('panelSettings.migrationFailed'))
      setMessage({ ok: true, text: result.message || t('panelSettings.restoreStarted') })
      const deadline = Date.now() + 30 * 60_000
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500))
        let statusResponse: Response
        try { statusResponse = await fetch(`/api/v1/system/migration?job=${encodeURIComponent(result.job)}`, { cache: 'no-store' }) }
        catch { continue } // Services restart while the helper continues restoring.
        if (statusResponse.status === 401) {
          setMessage({ ok: true, text: t('panelSettings.sessionSwitched') })
          return
        }
        if (!statusResponse.ok) continue
        const status = await statusResponse.json() as MigrationState
        setMessage({ ok: status.state !== 'failed', text: status.message || t('panelSettings.restoringProgress') })
        if (status.state === 'complete') {
          setFile(null)
          setConfirmation('')
          return
        }
        if (status.state === 'failed') return
      }
      setMessage({ ok: false, text: t('panelSettings.restoreStillRunning') })
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t('panelSettings.migrationFailed') })
    } finally { setBusy(false) }
  }

  return <section className="panel migration-module" aria-busy={busy}>
    <div className="section-title"><h2>{t('panelSettings.migrationTitle')}</h2><span className="count">{t('panelSettings.migrationCount')}</span></div>
    <p className="hint">{t('panelSettings.migrationHint')}</p>
    <div className="migration-grid">
      <div className="migration-pane">
        <h3>{t('panelSettings.exportTitle')}</h3>
        <p>{t('panelSettings.exportHint')}</p>
        <form action="/api/v1/system/migration/export" method="post" target="clover-migration-download" onSubmit={beginExport}>
          <label className="field">{t('panelSettings.exportPassphraseLabel')}
            <input type="password" name="passphrase" minLength={12} maxLength={256} autoComplete="new-password" required value={exportPassphrase} onChange={(event) => setExportPassphrase(event.target.value)} disabled={busy} />
          </label>
          <button type="submit" className="primary" disabled={busy}>{t('panelSettings.exportTitle')}</button>
        </form>
      </div>
      <div className="migration-pane">
        <h3>{t('panelSettings.importTitle')}</h3>
        <p className="migration-danger">{t('panelSettings.importDanger')}</p>
        <label className="field">{t('panelSettings.bundleLabel')}
          <input type="file" accept=".clover,application/vnd.clover.migration" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <label className="field">{t('panelSettings.passphraseLabel')}
          <input type="password" autoComplete="current-password" value={importPassphrase} disabled={busy} onChange={(event) => setImportPassphrase(event.target.value)} />
        </label>
        <label className="field">{t('panelSettings.restoreConfirmLabel')}
          <input value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} autoCapitalize="characters" />
        </label>
        <button type="button" className="primary" disabled={!file || busy} onClick={() => void importBundle()}>{busy ? t('panelSettings.restoring') : t('panelSettings.importTitle')}</button>
      </div>
    </div>
    {message && <p className={`msg ${message.ok ? 'ok' : 'err'}`} role="status" aria-live="polite">{message.text}</p>}
    <iframe name="clover-migration-download" title={t('panelSettings.downloadFrameTitle')} className="migration-download-frame" onLoad={(event) => {
      try {
        const result = JSON.parse(event.currentTarget.contentDocument?.body.textContent || '{}') as { error?: string }
        if (result.error) setMessage({ ok: false, text: result.error })
      } catch { /* File downloads do not render a JSON document. */ }
    }} />
  </section>
}
