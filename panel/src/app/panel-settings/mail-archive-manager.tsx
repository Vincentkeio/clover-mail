'use client'

import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

type MailboxOption = { id: number; login: string; active: boolean }
type ImportMode = 'folder' | 'merge' | 'replace'

export default function MailArchiveManager() {
  const { t } = useI18n()
  const [mailboxes, setMailboxes] = useState<MailboxOption[]>([])
  const [mailboxId, setMailboxId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('folder')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  // 切换语言会让这个 effect 重跑；只在还没选过邮箱时才填默认值，避免覆盖用户的选择。
  useEffect(() => {
    let active = true
    void fetch('/api/v1/mail-archive', { cache: 'no-store' }).then(async (res) => {
      if (!res.ok) throw new Error(t('panelSettings.mailboxListFailed'))
      return res.json() as Promise<MailboxOption[]>
    }).then((rows) => { if (active) { setMailboxes(rows); setMailboxId((current) => current || (rows[0] ? String(rows[0].id) : '')) } }).catch((error) => { if (active) setMessage({ ok: false, text: String(error) }) })
    return () => { active = false }
  }, [t])

  async function importMail() {
    if (!mailboxId || !file) return
    const selected = mailboxes.find((mailbox) => String(mailbox.id) === mailboxId)
    if (!selected) return
    const confirmation = importMode === 'replace'
      ? t('panelSettings.archiveConfirmReplace', { login: selected.login })
      : importMode === 'merge'
        ? t('panelSettings.archiveConfirmMerge', { login: selected.login })
        : t('panelSettings.archiveConfirmFolder', { login: selected.login })
    if (!window.confirm(confirmation)) return
    setBusy(true); setMessage(null)
    try {
      const form = new FormData(); form.set('file', file); form.set('mode', importMode)
      if (importMode === 'replace') form.set('confirmReplace', selected.login)
      const res = await fetch(`/api/v1/mailboxes/${mailboxId}/mail-archive`, { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || t('panelSettings.archiveImportFailed'))
      setMessage({ ok: true, text: t('panelSettings.archiveImported', { message: body.message }) })
      setFile(null)
      const input = document.getElementById('mail-archive-file') as HTMLInputElement | null
      if (input) input.value = ''
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) }) }
    finally { setBusy(false) }
  }

  return <div className="mail-archive-manager">
    <div className="mail-archive-heading"><div><h3>{t('panelSettings.archiveTitle')}</h3><p>{t('panelSettings.archiveHint')}</p></div></div>
    <div className="mail-archive-controls">
      <label className="field">{t('panelSettings.selectMailbox')}<select value={mailboxId} onChange={(event) => setMailboxId(event.target.value)} disabled={busy || mailboxes.length === 0}><option value="">{mailboxes.length ? t('panelSettings.selectMailbox') : t('panelSettings.noMailboxes')}</option>{mailboxes.map((mailbox) => <option value={mailbox.id} key={mailbox.id}>{mailbox.login}{mailbox.active ? '' : t('panelSettings.mailboxInactive')}</option>)}</select></label>
      <a className={`btn-link${!mailboxId ? ' is-disabled' : ''}`} href={mailboxId ? `/api/v1/mailboxes/${mailboxId}/mail-archive` : undefined} aria-disabled={!mailboxId}>{t('panelSettings.exportMailbox')}</a>
      <label className="field mail-archive-file-field">{t('panelSettings.archiveFileLabel')}<input id="mail-archive-file" type="file" accept=".tar.gz,application/gzip" disabled={!mailboxId || busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <label className="field mail-archive-mode-field">{t('panelSettings.importModeLabel')}<select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)} disabled={busy}><option value="folder">{t('panelSettings.modeFolder')}</option><option value="merge">{t('panelSettings.modeMerge')}</option><option value="replace">{t('panelSettings.modeReplace')}</option></select></label>
      <button type="button" className="primary" disabled={!mailboxId || !file || busy} onClick={() => void importMail()}>{busy ? t('panelSettings.importing') : t('panelSettings.importMail')}</button>
    </div>
    <p className={`mail-archive-note${importMode === 'replace' ? ' is-danger' : ''}`}>{importMode === 'folder' ? t('panelSettings.archiveNoteFolder') : importMode === 'merge' ? t('panelSettings.archiveNoteMerge') : t('panelSettings.archiveNoteReplace')} {t('panelSettings.archiveSizeNote')}</p>
    {message && <p className={`msg ${message.ok ? 'ok' : 'err'}`} role="status">{message.text}</p>}
  </div>
}
