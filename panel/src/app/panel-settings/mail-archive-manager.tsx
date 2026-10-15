'use client'

import { useEffect, useState } from 'react'

type MailboxOption = { id: number; login: string; active: boolean }
type ImportMode = 'folder' | 'merge' | 'replace'

export default function MailArchiveManager() {
  const [mailboxes, setMailboxes] = useState<MailboxOption[]>([])
  const [mailboxId, setMailboxId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('folder')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let active = true
    void fetch('/api/v1/mail-archive', { cache: 'no-store' }).then(async (res) => {
      if (!res.ok) throw new Error('读取邮箱列表失败')
      return res.json() as Promise<MailboxOption[]>
    }).then((rows) => { if (active) { setMailboxes(rows); setMailboxId(rows[0] ? String(rows[0].id) : '') } }).catch((error) => { if (active) setMessage({ ok: false, text: String(error) }) })
    return () => { active = false }
  }, [])

  async function importMail() {
    if (!mailboxId || !file) return
    const selected = mailboxes.find((mailbox) => String(mailbox.id) === mailboxId)
    if (!selected) return
    const confirmation = importMode === 'replace'
      ? `即将清空邮箱 ${selected.login} 中的全部现有邮件，再导入此归档。该操作不可撤销。请确认目标邮箱地址无误后继续。`
      : importMode === 'merge'
        ? `将归档邮件合并到 ${selected.login} 的现有文件夹，保留原邮件。重复导入可能产生重复邮件。继续吗？`
        : `将邮件导入 ${selected.login} 下新的 Imported 日期文件夹，不会覆盖现有邮件。重复导入可能产生重复邮件。继续吗？`
    if (!window.confirm(confirmation)) return
    setBusy(true); setMessage(null)
    try {
      const form = new FormData(); form.set('file', file); form.set('mode', importMode)
      if (importMode === 'replace') form.set('confirmReplace', selected.login)
      const res = await fetch(`/api/v1/mailboxes/${mailboxId}/mail-archive`, { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || '导入失败')
      setMessage({ ok: true, text: `${body.message} 可在 Roundcube 或其他 IMAP 客户端中查看。` })
      setFile(null)
      const input = document.getElementById('mail-archive-file') as HTMLInputElement | null
      if (input) input.value = ''
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) }) }
    finally { setBusy(false) }
  }

  return <div className="mail-archive-manager">
    <div className="mail-archive-heading"><div><h3>单邮箱邮件导入 / 导出</h3><p>导出包含该邮箱的邮件、文件夹与已读状态；导入时可选择新建文件夹、合并或覆盖。</p></div></div>
    <div className="mail-archive-controls">
      <label className="field">选择邮箱<select value={mailboxId} onChange={(event) => setMailboxId(event.target.value)} disabled={busy || mailboxes.length === 0}><option value="">{mailboxes.length ? '请选择邮箱' : '暂无邮箱账户'}</option>{mailboxes.map((mailbox) => <option value={mailbox.id} key={mailbox.id}>{mailbox.login}{mailbox.active ? '' : '（停用）'}</option>)}</select></label>
      <a className={`btn-link${!mailboxId ? ' is-disabled' : ''}`} href={mailboxId ? `/api/v1/mailboxes/${mailboxId}/mail-archive` : undefined} aria-disabled={!mailboxId}>导出此邮箱邮件</a>
      <label className="field mail-archive-file-field">导入本面板导出的归档<input id="mail-archive-file" type="file" accept=".tar.gz,application/gzip" disabled={!mailboxId || busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <label className="field mail-archive-mode-field">导入方式<select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)} disabled={busy}><option value="folder">新日期文件夹（保留原邮件）</option><option value="merge">合并到现有邮箱</option><option value="replace">覆盖现有邮件</option></select></label>
      <button type="button" className="primary" disabled={!mailboxId || !file || busy} onClick={() => void importMail()}>{busy ? '正在导入…' : '导入邮件'}</button>
    </div>
    <p className={`mail-archive-note${importMode === 'replace' ? ' is-danger' : ''}`}>{importMode === 'folder' ? '新日期文件夹：最安全，原邮件不动；重复导入会另建文件夹。' : importMode === 'merge' ? '合并：保留现有邮件并导入到对应文件夹；服务端不会自动去重，重复导入可能产生重复邮件。' : '覆盖：清空所选邮箱所有现有文件夹中的邮件，再导入归档；操作不可撤销。'} 支持 .tar.gz，单次最大 256 MiB。</p>
    {message && <p className={`msg ${message.ok ? 'ok' : 'err'}`} role="status">{message.text}</p>}
  </div>
}
