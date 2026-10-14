'use client'

import { useCallback, useEffect, useState } from 'react'
import { CertificatesSection } from '../certificates/certificates-section'

type Maintenance = {
  panelHost: string; mailHost: string; vpsIp: string; image: string; sourceMode: boolean; maintenanceAvailable: boolean
  host: { os: string; architecture: string; cpus: number | null; memoryBytes: number | null; dockerVersion: string }
  job: { state: string; exitCode: number | null; logs: string }
}
type UpdateCheck = {
  checkedAt: string; status: 'latest' | 'available' | 'source'; message: string
  latest: { tag: string; digest: string; createdAt: string; revision: string }
  upstream: { sha: string; shortSha: string; date: string; message: string; url: string } | null
}

export default function PanelSettings() {
  const [data, setData] = useState<Maintenance | null>(null)
  const [panelHost, setPanelHost] = useState('')
  const [mailHost, setMailHost] = useState('')
  const [ip, setIp] = useState('')
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState<'update' | 'restart' | 'configure' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [newAddress, setNewAddress] = useState('')
  const [reconcile, setReconcile] = useState('')
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(null)
  const [updateCheckError, setUpdateCheckError] = useState('')

  const load = useCallback(async (initialize = false) => {
    const res = await fetch('/api/v1/system/maintenance', { cache: 'no-store' })
    if (!res.ok) throw new Error('面板信息读取失败')
    const body = await res.json() as Maintenance
    setData(body)
    if (initialize) { setPanelHost(body.panelHost); setMailHost(body.mailHost); setIp(body.vpsIp) }
    return body
  }, [])

  useEffect(() => { void load(true).catch((err) => setMessage({ ok: false, text: String(err) })) }, [load])
  useEffect(() => {
    if (!data || !['running', 'created'].includes(data.job.state)) return
    const timer = window.setInterval(() => { void load().catch(() => undefined) }, 3500)
    return () => window.clearInterval(timer)
  }, [data, load])

  async function saveIp() {
    setBusy('ip'); setMessage(null)
    try {
      const res = await fetch('/api/v1/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vpsIp: ip.trim() }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || '保存失败')
      setMessage({ ok: true, text: '公网 IP 已保存。新增域名的 DNS 记录会使用此地址。' }); await load()
    } catch (err) { setMessage({ ok: false, text: err instanceof Error ? err.message : '保存失败' }) }
    finally { setBusy('') }
  }

  async function execute(action: 'update' | 'restart' | 'configure') {
    setBusy(action); setConfirm(null); setMessage(null)
    try {
      const res = await fetch('/api/v1/system/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, panelHost: panelHost.trim(), mailHost: mailHost.trim() }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || '操作失败')
      if (action === 'configure' && panelHost !== data?.panelHost) setNewAddress(`https://${panelHost.trim()}/`)
      setMessage({ ok: true, text: body.message || '任务已启动。' })
      await load().catch(() => undefined)
    } catch (err) { setMessage({ ok: false, text: err instanceof Error ? err.message : '操作失败' }) }
    finally { setBusy('') }
  }

  async function checkAccounts() {
    setReconcile('检查中…')
    try {
      const res = await fetch('/api/v1/system/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heal: false }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || '对账失败')
      const missing = (body.mailboxes?.missing?.length || 0) + (body.rules?.missing?.length || 0)
      const extra = (body.mailboxes?.extra?.length || 0) + (body.rules?.extra?.length || 0)
      setReconcile(`检查完成：缺失 ${missing} 项，多余 ${extra} 项。`)
    } catch (err) { setReconcile(err instanceof Error ? err.message : '对账失败') }
  }

  async function checkUpdates() {
    setBusy('check-updates'); setUpdateCheckError('')
    try {
      const res = await fetch('/api/v1/system/update-check', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || '检查更新失败')
      setUpdateCheck(body as UpdateCheck)
    } catch (err) { setUpdateCheckError(err instanceof Error ? err.message : '检查更新失败') }
    finally { setBusy('') }
  }

  const running = data && ['running', 'created'].includes(data.job.state)
  const changed = data && (panelHost.trim() !== data.panelHost || mailHost.trim() !== data.mailHost)
  const memory = data?.host.memoryBytes ? `${(data.host.memoryBytes / 1024 ** 3).toFixed(1)} GB` : '—'
  return <main className="wrap panel-settings-page">
    <div className="topbar"><div><p className="eyebrow">CONTROL / SETTINGS</p><h1>面板设置</h1><p className="hint">管理面板入口、邮件主机、TLS 证书和本机运行状态。</p></div></div>
    {message && <div className={`msg ${message.ok ? 'ok' : 'err'}`} role="status">{message.text}{newAddress && <> 新地址：<a href={newAddress} target="_blank" rel="noreferrer">{newAddress}</a></>}</div>}
    <div className="panel-settings-overview">
      <section className="panel panel-identity" id="mail-host"><div className="section-title"><h2>面板与邮件主机</h2><span className="count">域名设置</span></div>
        <p className="hint">先将两个域名的 A 记录指向本机 IP，再应用新配置。面板地址变更后，请从新地址重新打开。</p>
        <div className="panel-domain-fields"><label className="field">面板域名<input value={panelHost} onChange={(event) => setPanelHost(event.target.value)} placeholder="panel.example.com" spellCheck={false} /></label>
          <label className="field">邮件主机名<input value={mailHost} onChange={(event) => setMailHost(event.target.value)} placeholder="mail.example.com" spellCheck={false} /></label></div>
        <div className="panel-setting-actions"><button type="button" className="primary" disabled={!changed || Boolean(running) || Boolean(busy)} onClick={() => setConfirm('configure')}>应用域名配置</button><span className="hint-text">邮件主机名用于 SMTP、IMAP 与 TLS；每个邮箱域名共用此主机。</span></div>
      </section>
      <section className="panel panel-host"><div className="section-title"><h2>宿主机信息</h2><span className="count">{data?.host.architecture || '读取中'}</span></div>
        <dl className="host-facts"><div><dt>操作系统</dt><dd>{data?.host.os || '—'}</dd></div><div><dt>CPU / 内存</dt><dd>{data?.host.cpus || '—'} 核 / {memory}</dd></div><div><dt>Docker</dt><dd>{data?.host.dockerVersion || '—'}</dd></div><div><dt>面板镜像</dt><dd className="mono">{data?.image || '—'}</dd></div></dl>
        <label className="field host-ip-field">VPS 公网 IP<input value={ip} onChange={(event) => setIp(event.target.value)} inputMode="decimal" placeholder="203.0.113.10" /></label>
        <div className="panel-setting-actions"><button type="button" disabled={busy === 'ip' || ip.trim() === data?.vpsIp} onClick={() => void saveIp()}>{busy === 'ip' ? '保存中…' : '保存公网 IP'}</button></div>
      </section>
    </div>
    <CertificatesSection embedded />
    <section className="panel panel-maintenance" id="maintenance"><div className="section-title"><div><h2>更新与重启</h2><p className="hint">更新前自动备份面板数据库；运行中的任务会显示在下方。</p></div><span className={`tag ${running ? 'warn' : data?.job.state === 'exited' && data.job.exitCode ? 'err' : 'ok'}`}>{running ? '任务进行中' : data?.job.state === 'exited' && data.job.exitCode ? '上次任务失败' : '可操作'}</span></div>
      <div className="panel-maintenance-actions"><button type="button" disabled={Boolean(running) || Boolean(busy)} onClick={() => void checkUpdates()}>{busy === 'check-updates' ? '检查中…' : '检查更新'}</button><button type="button" className="primary" disabled={Boolean(running) || !data?.maintenanceAvailable || Boolean(busy)} onClick={() => setConfirm('update')}>更新面板</button>
        <button type="button" disabled={Boolean(running) || !data?.maintenanceAvailable || Boolean(busy)} onClick={() => setConfirm('restart')}>重启面板</button></div>
      <p className="hint">{data?.sourceMode ? '源码部署：更新操作只会重建本机现有源码，不会拉取上游代码；请先同步代码再更新。' : '发布镜像部署：更新会备份数据库、拉取最新镜像并切换面板。'}</p>
      {updateCheck && <div className={`msg ${updateCheck.status === 'latest' ? 'ok' : 'warn'}`} role="status"><p>{updateCheck.message}</p><p className="hint">最新发布镜像：{updateCheck.latest.createdAt ? new Date(updateCheck.latest.createdAt).toLocaleString('zh-CN') : '已读取'} · 检查时间：{new Date(updateCheck.checkedAt).toLocaleString('zh-CN')}</p>{updateCheck.upstream && <p className="hint">上游 main：<a href={updateCheck.upstream.url} target="_blank" rel="noreferrer">{updateCheck.upstream.shortSha}</a>{updateCheck.upstream.message ? ` · ${updateCheck.upstream.message}` : ''}{updateCheck.upstream.date ? ` · ${new Date(updateCheck.upstream.date).toLocaleString('zh-CN')}` : ''}</p>}</div>}
      {updateCheckError && <div className="msg err" role="alert">检查更新失败：{updateCheckError}</div>}
      {data?.job.logs && <details className="maintenance-log" open={Boolean(running) || Boolean(data.job.exitCode)}><summary>维护任务记录 · {data.job.state}</summary><pre>{data.job.logs}</pre></details>}
    </section>
    <section className="panel"><div className="section-title"><h2>备份与账号对账</h2></div><p className="hint">下载面板数据库快照和邮件服务配置；对账会比较面板记录与邮件服务账号，不自动修改数据。</p>
      <div className="panel-maintenance-actions"><a className="btn-link" href="/api/v1/system/backup?what=db">下载面板数据库</a><a className="btn-link" href="/api/v1/system/backup?what=dms-config">下载邮件配置</a><button type="button" onClick={() => void checkAccounts()}>检查账号同步</button></div>
      {reconcile && <p className="hint" role="status">{reconcile}</p>}
    </section>
    {confirm && <div className="maintenance-confirm" role="dialog" aria-modal="true" aria-label="确认面板操作"><div className="maintenance-confirm-card"><h2>{confirm === 'configure' ? '应用域名配置' : confirm === 'update' ? '更新面板' : '重启面板'}</h2>
      <p>{confirm === 'configure' ? `将面板设置为 ${panelHost}，邮件主机设置为 ${mailHost}。服务会短暂重启。` : confirm === 'update' ? '将备份数据库并更新面板，页面会短暂不可用。' : '面板会短暂不可用，邮件服务继续运行。'}</p>
      <div className="panel-maintenance-actions"><button type="button" onClick={() => setConfirm(null)}>取消</button><button type="button" className="primary" onClick={() => void execute(confirm)}>确认执行</button></div></div></div>}
  </main>
}
