'use client'

import { useState } from 'react'

type Kind = 'db' | 'dms-config'

export default function BackupImports() {
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
    const label = kind === 'db' ? '面板数据库' : '邮件服务配置'
    const warning = kind === 'db'
      ? '导入后会覆盖当前面板数据库，并重启面板。当前数据库会保留为恢复副本。'
      : '导入后会覆盖邮件服务配置，并重启邮件服务。系统会尝试自动恢复原配置。'
    if (!window.confirm(`${warning}\n\n确认导入「${file.name}」？`)) return
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
        if (!ready) throw new Error('等待面板重启超时，请检查服务状态。')
        setMessage({ kind, ok: true, text: '面板数据库已导入，服务已恢复。' })
        setFiles((value) => ({ ...value, [kind]: null }))
        return
      }
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string }
      if (!response.ok) throw new Error(body.error || '导入失败。')
      if (kind === 'db') {
        const ready = await waitForPanel()
        if (!ready) throw new Error('数据库已替换，但面板未能在时限内恢复；请检查服务状态。')
      }
      setMessage({ kind, ok: true, text: body.message || `${label}已导入。` })
      setFiles((value) => ({ ...value, [kind]: null }))
    } catch (error) {
      setMessage({ kind, ok: false, text: error instanceof Error ? error.message : '导入失败。' })
    } finally { setBusy('') }
  }

  return <div className="backup-imports" aria-busy={Boolean(busy)}>
    <div className="backup-import-row">
      <label className="field">导入面板数据库
        <input type="file" accept=".db,application/vnd.sqlite3" disabled={Boolean(busy)} onChange={(event) => setFiles((value) => ({ ...value, db: event.target.files?.[0] ?? null }))} />
      </label>
      <button type="button" disabled={!files.db || Boolean(busy)} onClick={() => void importFile('db')}>{busy === 'db' ? '正在导入…' : '导入数据库'}</button>
    </div>
    <div className="backup-import-row">
      <label className="field">导入邮件配置
        <input type="file" accept=".tar.gz,application/gzip" disabled={Boolean(busy)} onChange={(event) => setFiles((value) => ({ ...value, 'dms-config': event.target.files?.[0] ?? null }))} />
      </label>
      <button type="button" disabled={!files['dms-config'] || Boolean(busy)} onClick={() => void importFile('dms-config')}>{busy === 'dms-config' ? '正在导入…' : '导入邮件配置'}</button>
    </div>
    {message && <p className={`msg ${message.ok ? 'ok' : 'err'}`} role="status">{message.text}</p>}
  </div>
}
