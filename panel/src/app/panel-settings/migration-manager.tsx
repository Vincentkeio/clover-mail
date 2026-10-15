'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'

type MigrationState = { state: string; message: string }

export default function MigrationManager() {
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function beginExport(event: FormEvent<HTMLFormElement>) {
    if (exportPassphrase.length < 12) {
      event.preventDefault()
      setMessage({ ok: false, text: '迁移口令至少需要 12 个字符。' })
      return
    }
    setMessage({ ok: true, text: '迁移包正在生成，请查看浏览器下载列表；下载完成后再执行恢复。' })
  }

  async function importBundle() {
    if (!file || busy) return
    if (confirmation !== 'RESTORE') {
      setMessage({ ok: false, text: '请输入 RESTORE 以确认覆盖目标实例。' })
      return
    }
    if (importPassphrase.length < 12) {
      setMessage({ ok: false, text: '请输入导出时设置的迁移口令。' })
      return
    }
    setBusy(true)
    setMessage({ ok: true, text: '正在上传并校验迁移包…' })
    try {
      const response = await fetch('/api/v1/system/migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.clover.migration', 'X-Clover-Migration-Passphrase': btoa(String.fromCharCode(...new TextEncoder().encode(importPassphrase))), 'X-Clover-Confirm': confirmation },
        body: file,
      })
      const result = await response.json() as { error?: string; job?: string; message?: string }
      if (!response.ok || !result.job) throw new Error(result.error || '迁移包导入失败。')
      setMessage({ ok: true, text: result.message || '恢复任务已启动。' })
      const deadline = Date.now() + 30 * 60_000
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500))
        let statusResponse: Response
        try { statusResponse = await fetch(`/api/v1/system/migration?job=${encodeURIComponent(result.job)}`, { cache: 'no-store' }) }
        catch { continue } // Services restart while the helper continues restoring.
        if (statusResponse.status === 401) {
          setMessage({ ok: true, text: '面板登录信息已切换，请使用源面板账号重新登录并检查恢复结果。' })
          return
        }
        if (!statusResponse.ok) continue
        const status = await statusResponse.json() as MigrationState
        setMessage({ ok: status.state !== 'failed', text: status.message || '恢复进行中…' })
        if (status.state === 'complete') {
          setFile(null)
          setConfirmation('')
          return
        }
        if (status.state === 'failed') return
      }
      setMessage({ ok: false, text: '恢复仍在进行；请稍后重新打开面板查看服务状态。' })
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : '迁移包导入失败。' })
    } finally { setBusy(false) }
  }

  return <section className="panel migration-module" aria-busy={busy}>
    <div className="section-title"><h2>一键迁移</h2><span className="count">独立工具</span></div>
    <p className="hint">导出包包含面板数据库、邮件正文、Roundcube 通讯录与偏好、邮件配置、服务密钥及部署配置。迁移包使用口令加密，请妥善保存口令和文件。</p>
    <div className="migration-grid">
      <div className="migration-pane">
        <h3>导出迁移包</h3>
        <p>生成后下载到本机。导出时邮件与 WebMail 会短暂停止，面板仍可使用。</p>
        <form action="/api/v1/system/migration/export" method="post" target="clover-migration-download" onSubmit={beginExport}>
          <label className="field">设置迁移口令（至少 12 个字符）
            <input type="password" name="passphrase" minLength={12} maxLength={256} autoComplete="new-password" required value={exportPassphrase} onChange={(event) => setExportPassphrase(event.target.value)} disabled={busy} />
          </label>
          <button type="submit" className="primary" disabled={busy}>导出迁移包</button>
        </form>
      </div>
      <div className="migration-pane">
        <h3>导入并恢复</h3>
        <p className="migration-danger">恢复会覆盖目标 Clover 实例的数据库、配置和全部数据卷，并重启服务。仅在新 VPS 或已确认可覆盖的目标机执行。</p>
        <label className="field">迁移包
          <input type="file" accept=".clover,application/vnd.clover.migration" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <label className="field">迁移口令
          <input type="password" autoComplete="current-password" value={importPassphrase} disabled={busy} onChange={(event) => setImportPassphrase(event.target.value)} />
        </label>
        <label className="field">输入 RESTORE 确认覆盖
          <input value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} autoCapitalize="characters" />
        </label>
        <button type="button" className="primary" disabled={!file || busy} onClick={() => void importBundle()}>{busy ? '正在恢复…' : '导入并恢复'}</button>
      </div>
    </div>
    {message && <p className={`msg ${message.ok ? 'ok' : 'err'}`} role="status" aria-live="polite">{message.text}</p>}
    <iframe name="clover-migration-download" title="迁移包下载" className="migration-download-frame" onLoad={(event) => {
      try {
        const result = JSON.parse(event.currentTarget.contentDocument?.body.textContent || '{}') as { error?: string }
        if (result.error) setMessage({ ok: false, text: result.error })
      } catch { /* File downloads do not render a JSON document. */ }
    }} />
  </section>
}
