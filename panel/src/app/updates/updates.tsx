'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'
import type { MessageKey } from '@/lib/i18n/types'
import { checkForUpdates, UPDATE_CHECK_FAILED, useUpdateStatus } from '@/lib/update-client'
import { normalizeVersion } from '@/lib/versions'

type Maintenance = { maintenanceAvailable: boolean; job: { state: string; exitCode: number | null; logs: string } }
type Task = { ticket: string; action: 'update' | 'restart'; startedAt: number }
const taskKey = 'clover-pending-maintenance'
const formatDate = (value: string, dateLocale: string) => value ? new Date(value).toLocaleString(dateLocale) : '—'
const formatVersion = (value?: string) => normalizeVersion(value) || '—'

export default function Updates() {
  const { t, dateLocale } = useI18n()
  const update = useUpdateStatus()
  const [maintenance, setMaintenance] = useState<Maintenance | null>(null)
  const [confirm, setConfirm] = useState<'update' | 'restart' | null>(null)
  const [busy, setBusy] = useState(false)
  const [task, setTask] = useState<Task | null>(null)
  const [progress, setProgress] = useState<MessageKey>('updates.progressWorking')
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const response = await fetch('/api/v1/system/maintenance', { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || t('updates.loadFailed'))
    setMaintenance(data)
  }, [t])
  useEffect(() => {
    void checkForUpdates()
    void load().catch((e) => setError(e.message))
    try {
      const saved = JSON.parse(sessionStorage.getItem(taskKey) || 'null') as Task | null
      if (saved && ['update', 'restart'].includes(saved.action) && typeof saved.ticket === 'string' && Date.now() - saved.startedAt < 45 * 60_000) setTask(saved)
    } catch { /* Browser storage is optional. */ }
  }, [load])
  const finish = useCallback((message: MessageKey) => {
    setTask(null); setError(t(message))
    try { sessionStorage.removeItem(taskKey) } catch { /* Browser storage is optional. */ }
    void load().catch(() => undefined)
  }, [load, t])
  useEffect(() => {
    if (!task) return
    let stopped = false
    let timer: number | undefined
    let controller: AbortController | undefined
    async function poll() {
      if (stopped || !task) return
      if (Date.now() - task.startedAt > 45 * 60_000) { finish('updates.taskTimeout'); return }
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 8000)
      try {
        const response = await fetch('/api/v1/system/maintenance/status?ticket=' + encodeURIComponent(task.ticket), { cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal })
        if (stopped) return
        if (response.status === 403) { finish('updates.ticketExpired'); return }
        if (!response.ok) throw new Error(t('updates.serviceUnavailable'))
        const status = await response.json() as { state: string; exitCode: number | null; ready: boolean }
        if (stopped) return
        if (['exited', 'dead'].includes(status.state) && status.exitCode !== 0) { finish('updates.taskFailed'); return }
        if (status.ready) {
          try { sessionStorage.removeItem(taskKey) } catch { /* Browser storage is optional. */ }
          setProgress('updates.progressReloading')
          window.location.reload()
          return
        }
        setProgress(task.action === 'update' ? 'updates.progressUpdating' : 'updates.progressRestarting')
      } catch { if (!stopped) setProgress('updates.progressReconnecting') }
      finally { window.clearTimeout(timeout) }
      if (!stopped) timer = window.setTimeout(() => void poll(), 3500)
    }
    void poll()
    return () => { stopped = true; controller?.abort(); if (timer !== undefined) window.clearTimeout(timer) }
  }, [task, finish, t])

  async function execute(action: 'update' | 'restart') {
    setConfirm(null); setBusy(true); setError('')
    try {
      const response = await fetch('/api/v1/system/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, confirm: true }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || t('updates.startFailed'))
      if (!body.ticket) throw new Error(t('updates.ticketMissing'))
      const pending: Task = { ticket: body.ticket, action, startedAt: Date.now() }
      try { sessionStorage.setItem(taskKey, JSON.stringify(pending)) } catch { /* Browser storage is optional. */ }
      setProgress(action === 'update' ? 'updates.progressStartUpdate' : 'updates.progressStartRestart')
      setTask(pending)
    } catch (e) { setError(e instanceof Error ? e.message : t('updates.actionFailed')) }
    finally { setBusy(false) }
  }
  const result = update.result
  const running = Boolean(task) || ['running', 'created'].includes(maintenance?.job.state || '')
  const disabled = running || busy || !maintenance?.maintenanceAvailable
  return <main className="wrap panel-settings-page">
    <div className="topbar"><div><p className="eyebrow">ADVANCED / UPDATES</p><h1>{t('updates.title')}</h1><p className="hint">{t('updates.intro')}</p></div></div>
    <section className="panel" aria-busy={update.checking}>
      <div className="section-title"><h2>{t('updates.versionSection')}</h2><span className={'tag ' + (result?.status === 'available' ? 'warn' : result?.status === 'latest' ? 'ok' : '')}>{update.checking ? t('updates.statusChecking') : result?.status === 'available' ? t('updates.statusAvailable') : result?.status === 'latest' ? t('updates.statusLatest') : result?.status === 'source' ? t('updates.statusSource') : t('updates.statusPending')}</span></div>
      <p className="hint">{update.manualChecking ? t('updates.checkingManual') : update.checking ? t('updates.checkingAuto') : result?.message || t('updates.versionPending')}</p>
      <dl className="update-version-grid"><div><dt>{t('updates.currentVersion')}</dt><dd>{formatVersion(result?.current.version)}</dd></div><div><dt>{t('updates.latestVersion')}</dt><dd>{formatVersion(result?.latest.version)}</dd></div><div><dt>{t('updates.lastChecked')}</dt><dd>{formatDate(update.checkedAt, dateLocale)}</dd></div></dl>
      {result?.latest.releaseUrl && <p className="hint"><a href={result.latest.releaseUrl} target="_blank" rel="noreferrer">{t('updates.releaseNotes', { version: formatVersion(result.latest.version) })}</a></p>}
      {update.error && <p className="msg err" role="alert">{t('updates.checkErrorHint', { error: update.error === UPDATE_CHECK_FAILED ? t('updates.checkFailed') : update.error })}</p>}
      <div className="panel-maintenance-actions"><button type="button" disabled={update.manualChecking || running || busy} onClick={() => void checkForUpdates(true)}>{update.manualChecking ? t('updates.checking') : update.checking ? t('updates.checkAgain') : t('updates.checkNow')}</button><button type="button" className="primary" disabled={disabled || update.checking || !result || result.status === 'latest'} onClick={() => setConfirm('update')}>{t('updates.updateNow')}</button></div>
      <p className="hint">{t('updates.updateHint')}</p>
      {result?.current.sourceBuild && <p className="hint">{t('updates.sourceBuildHint')}</p>}
    </section>
    <section className="panel"><div className="section-title"><h2>{t('updates.restartSection')}</h2></div><p className="hint">{t('updates.restartHint')}</p><button type="button" disabled={disabled} onClick={() => setConfirm('restart')}>{t('updates.restartPanel')}</button></section>
    {error && <div className="msg err" role="alert">{error}</div>}
    {task && <div className="msg warn update-task-status" role="status" aria-live="polite"><span className="domain-apply-spinner" aria-hidden="true"/>{t(progress)}</div>}
    <section className="panel"><div className="section-title"><h2>{t('updates.tasksSection')}</h2><span className="count">{running ? t('updates.jobRunning') : maintenance?.job.state === 'exited' ? maintenance.job.exitCode === 0 ? t('updates.jobDone') : t('updates.jobFailed') : t('updates.jobNone')}</span></div>{maintenance?.job.logs ? <details className="maintenance-log" open={Boolean(maintenance.job.exitCode)}><summary>{t('updates.jobLogsSummary')}</summary><pre>{maintenance.job.logs}</pre></details> : <p className="hint">{t('updates.jobLogsEmpty')}</p>}<button type="button" disabled={busy} onClick={() => void load().catch((e) => setError(e.message))}>{t('updates.refreshTasks')}</button></section>
    {confirm && <div className="maintenance-confirm" role="dialog" aria-modal="true" aria-labelledby="update-confirm-title" onKeyDown={(event) => { if (event.key === 'Escape') setConfirm(null) }}><div className="maintenance-confirm-card"><h2 id="update-confirm-title">{confirm === 'update' ? t('updates.confirmUpdateTitle') : t('updates.confirmRestartTitle')}</h2><p>{confirm === 'update' ? t('updates.confirmUpdateBody') : t('updates.confirmRestartBody')}</p><div className="panel-maintenance-actions"><button type="button" autoFocus onClick={() => setConfirm(null)}>{t('common.cancel')}</button><button type="button" className="primary" onClick={() => void execute(confirm)}>{t('updates.confirmRun')}</button></div></div></div>}
  </main>
}
