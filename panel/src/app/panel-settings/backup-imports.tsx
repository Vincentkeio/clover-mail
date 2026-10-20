'use client'

import { useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

type Kind = 'db' | 'dms-config'

export default function BackupImports() {
  const { t } = useI18n()
  const [files, setFiles] = useState<Record<Kind, File | null>>({ db: null, 'dms-config': null })
  const [busy, setBusy] = useState<Kind | ''>('')
  const [message, setMessage] = useState<{ kind: Kind; ok: boolean; text: string } | null>(null)

  async function waitForPanel() {
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 1800))
      try {
        const response = await fetch('/api/health', { cache: 'no-store' })
        if (response.ok) return true
      } catch { /* The panel is restarting. */ }
    }
    return false
  }

  async function importFile(kind: Kind) {
    const file = files[kind]
    if (!file || busy) return
    const label = kind === 'db' ? t('panelSettings.dbLabel') : t('panelSettings.dmsLabel')
    const warning = kind === 'db'
      ? t('panelSettings.importWarningDb')
      : t('panelSettings.importWarningDms')
    if (!window.confirm(`${warning}\n\n${t('panelSettings.importConfirm', { file: file.name })}`)) return
    setBusy(kind)
    setMessage(null)
    try {
      const form = new FormData()
      form.set('file', file)
      let response: Response
      try {
        response = await fetch(`/api/v1/system/backup?what=${kind}`, { method: 'POST', body: form })
      } catch (error) {
        if (kind !== 'db') throw error
        const ready = await waitForPanel()
        if (!ready) throw new Error(t('panelSettings.waitPanelTimeout'))
        setMessage({ kind, ok: true, text: t('panelSettings.dbImportedRestarted') })
        setFiles((value) => ({ ...value, [kind]: null }))
        return
      }
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string }
      if (!response.ok) throw new Error(body.error || t('panelSettings.importFailed'))
      if (kind === 'db') {
        const ready = await waitForPanel()
        if (!ready) throw new Error(t('panelSettings.dbNotRecovered'))
      }
      setMessage({ kind, ok: true, text: body.message || t('panelSettings.imported', { label }) })
      setFiles((value) => ({ ...value, [kind]: null }))
    } catch (error) {
      setMessage({ kind, ok: false, text: error instanceof Error ? error.message : t('panelSettings.importFailed') })
    } finally { setBusy('') }
  }

  return <div className="backup-imports" aria-busy={Boolean(busy)}>
    <div className="backup-import-row">
      <label className="field">{t('panelSettings.importDbLabel')}
        <input type="file" accept=".db,application/vnd.sqlite3" disabled={Boolean(busy)} onChange={(event) => setFiles((value) => ({ ...value, db: event.target.files?.[0] ?? null }))} />
      </label>
      <button type="button" disabled={!files.db || Boolean(busy)} onClick={() => void importFile('db')}>{busy === 'db' ? t('panelSettings.importing') : t('panelSettings.importDbAction')}</button>
    </div>
    <div className="backup-import-row">
      <label className="field">{t('panelSettings.importDms')}
        <input type="file" accept=".tar.gz,application/gzip" disabled={Boolean(busy)} onChange={(event) => setFiles((value) => ({ ...value, 'dms-config': event.target.files?.[0] ?? null }))} />
      </label>
      <button type="button" disabled={!files['dms-config'] || Boolean(busy)} onClick={() => void importFile('dms-config')}>{busy === 'dms-config' ? t('panelSettings.importing') : t('panelSettings.importDms')}</button>
    </div>
    {message && <p className={`msg ${message.ok ? 'ok' : 'err'}`} role="status">{message.text}</p>}
  </div>
}
