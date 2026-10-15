'use client'

import { useCallback, useEffect, useState } from 'react'
import { checkForUpdates, useUpdateStatus } from '@/lib/update-client'

type Maintenance = { maintenanceAvailable: boolean; job: { state: string; exitCode: number | null; logs: string } }
type Task = { ticket: string; action: 'update' | 'restart'; startedAt: number }
const taskKey = 'clover-pending-maintenance'
const formatDate = (value: string) => value ? new Date(value).toLocaleString('zh-CN') : '—'

export default function Updates() {
  const update = useUpdateStatus()
  const [maintenance, setMaintenance] = useState<Maintenance | null>(null)
  const [confirm, setConfirm] = useState<'update' | 'restart' | null>(null)
  const [busy, setBusy] = useState(false)
  const [task, setTask] = useState<Task | null>(null)
  const [progress, setProgress] = useState('正在执行维护任务…')
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const response = await fetch('/api/v1/system/maintenance', { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '无法读取维护任务状态。')
    setMaintenance(data)
  }, [])
  useEffect(() => {
    void checkForUpdates()
    void load().catch((e) => setError(e.message))
    try {
      const saved = JSON.parse(sessionStorage.getItem(taskKey) || 'null') as Task | null
      if (saved && ['update', 'restart'].includes(saved.action) && typeof saved.ticket === 'string' && Date.now() - saved.startedAt < 45 * 60_000) setTask(saved)
    } catch { /* Browser storage is optional. */ }
  }, [load])
  const finish = useCallback((message: string) => {
    setTask(null); setError(message)
    try { sessionStorage.removeItem(taskKey) } catch { /* Browser storage is optional. */ }
    void load().catch(() => undefined)
  }, [load])
  useEffect(() => {
    if (!task) return
    let stopped = false
    let timer: number | undefined
    let controller: AbortController | undefined
    async function poll() {
      if (stopped || !task) return
      if (Date.now() - task.startedAt > 45 * 60_000) { finish('等待任务完成超时，请查看任务记录或通过 clover 查看服务状态。'); return }
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 8000)
      try {
        const response = await fetch('/api/v1/system/maintenance/status?ticket=' + encodeURIComponent(task.ticket), { cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal })
        if (stopped) return
        if (response.status === 403) { finish('任务查询凭据已失效，请刷新页面查看任务记录。'); return }
        if (!response.ok) throw new Error('服务暂时不可用')
        const status = await response.json() as { state: string; exitCode: number | null; ready: boolean }
        if (stopped) return
        if (['exited', 'dead'].includes(status.state) && status.exitCode !== 0) { finish('维护任务失败，请查看下方任务记录。'); return }
        if (status.ready) {
          try { sessionStorage.removeItem(taskKey) } catch { /* Browser storage is optional. */ }
          setProgress('维护已完成，正在重新加载页面…')
          window.location.reload()
          return
        }
        setProgress(task.action === 'update' ? '正在备份、同步代码并更新服务，请稍候…' : '正在重启面板，请稍候…')
      } catch { if (!stopped) setProgress('服务正在切换，正在等待重新连接…') }
      finally { window.clearTimeout(timeout) }
      if (!stopped) timer = window.setTimeout(() => void poll(), 3500)
    }
    void poll()
    return () => { stopped = true; controller?.abort(); if (timer !== undefined) window.clearTimeout(timer) }
  }, [task, finish])

  async function execute(action: 'update' | 'restart') {
    setConfirm(null); setBusy(true); setError('')
    try {
      const response = await fetch('/api/v1/system/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, confirm: true }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '无法启动维护任务。')
      if (!body.ticket) throw new Error('任务已启动，请刷新页面查看维护记录。')
      const pending: Task = { ticket: body.ticket, action, startedAt: Date.now() }
      try { sessionStorage.setItem(taskKey, JSON.stringify(pending)) } catch { /* Browser storage is optional. */ }
      setProgress(action === 'update' ? '正在启动更新任务…' : '正在重启面板…')
      setTask(pending)
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败。') }
    finally { setBusy(false) }
  }
  const result = update.result
  const running = Boolean(task) || ['running', 'created'].includes(maintenance?.job.state || '')
  const disabled = running || busy || !maintenance?.maintenanceAvailable
  return <main className="wrap panel-settings-page">
    <div className="topbar"><div><p className="eyebrow">ADVANCED / UPDATES</p><h1>更新与重启</h1><p className="hint">每日首次进入面板时检查更新，在菜单上提示；更新与重启均需手动确认。</p></div></div>
    <section className="panel" aria-busy={update.checking}>
      <div className="section-title"><h2>版本更新</h2><span className={'tag ' + (result?.status === 'available' ? 'warn' : result?.status === 'latest' ? 'ok' : '')}>{update.checking ? '检查中' : result?.status === 'available' ? '有新版本' : result?.status === 'latest' ? '已是最新' : '等待检查'}</span></div>
      <p className="hint">{result?.message || '正在读取当前版本和发布信息。'}</p>
      <dl className="update-version-grid"><div><dt>当前面板版本</dt><dd>{result ? `v${result.current.version}` : '—'}{result?.current.revision && <small className="hint"> · {result.current.revision.slice(0, 7)}</small>}</dd></div><div><dt>最新发布</dt><dd>{result?.latest.revision.slice(0, 7) || '—'}<small className="hint"> · {formatDate(result?.latest.createdAt || '')}</small></dd></div><div><dt>最近检查</dt><dd>{formatDate(update.checkedAt)}</dd></div></dl>
      {result?.upstream && <p className="hint">更新说明：<a href={result.upstream.url} target="_blank" rel="noreferrer">{result.upstream.message || result.upstream.shortSha}</a></p>}
      {update.error && <p className="msg err" role="alert">检查更新失败：{update.error} 可点击下方按钮重试。</p>}
      <div className="panel-maintenance-actions"><button type="button" disabled={update.checking || running || busy} onClick={() => void checkForUpdates(true)}>{update.checking ? '检查中…' : '检查更新'}</button><button type="button" className="primary" disabled={disabled || update.checking || !result || result.status === 'latest'} onClick={() => setConfirm('update')}>立即更新</button></div>
      <p className="hint">确认后先备份，再同步源码、脚本与 Compose 配置，拉取最新发布镜像并检查服务状态。配置和邮件数据会保留。</p>
      {result?.current.sourceBuild && <p className="hint">当前为本地构建；确认更新后将切换到最新发布镜像。</p>}
    </section>
    <section className="panel"><div className="section-title"><h2>重启面板</h2></div><p className="hint">仅重启面板，邮件服务继续运行；页面会短暂断开连接。</p><button type="button" disabled={disabled} onClick={() => setConfirm('restart')}>重启面板</button></section>
    {error && <div className="msg err" role="alert">{error}</div>}
    {task && <div className="msg warn update-task-status" role="status" aria-live="polite"><span className="domain-apply-spinner" aria-hidden="true"/>{progress}</div>}
    <section className="panel"><div className="section-title"><h2>维护任务记录</h2><span className="count">{running ? '进行中' : maintenance?.job.state === 'exited' ? maintenance.job.exitCode === 0 ? '已完成' : '失败' : '暂无任务'}</span></div>{maintenance?.job.logs ? <details className="maintenance-log" open={Boolean(maintenance.job.exitCode)}><summary>查看最近任务日志</summary><pre>{maintenance.job.logs}</pre></details> : <p className="hint">维护任务完成后，可在这里查看执行记录。</p>}<button type="button" disabled={busy} onClick={() => void load().catch((e) => setError(e.message))}>刷新任务记录</button></section>
    {confirm && <div className="maintenance-confirm" role="dialog" aria-modal="true" aria-labelledby="update-confirm-title" onKeyDown={(event) => { if (event.key === 'Escape') setConfirm(null) }}><div className="maintenance-confirm-card"><h2 id="update-confirm-title">{confirm === 'update' ? '确认更新' : '确认重启面板'}</h2><p>{confirm === 'update' ? '将备份面板数据库，更新至最新发布版本，并同步脚本和 Compose 配置。服务会短暂重启。' : '面板会短暂不可用，邮件服务继续运行。'}</p><div className="panel-maintenance-actions"><button type="button" autoFocus onClick={() => setConfirm(null)}>取消</button><button type="button" className="primary" onClick={() => void execute(confirm)}>确认执行</button></div></div></div>}
  </main>
}
