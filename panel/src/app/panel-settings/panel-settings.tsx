'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'
import type { MessageKey } from '@/lib/i18n/types'
import { CertificatesSection } from '../certificates/certificates-section'
import MailArchiveManager from './mail-archive-manager'
import BackupImports from './backup-imports'
import MigrationManager from './migration-manager'

type Maintenance = {
  panelHost: string; mailHost: string; vpsIp: string; image: string; sourceMode: boolean; maintenanceAvailable: boolean
  host: { os: string; architecture: string; cpus: number | null; memoryBytes: number | null; dockerVersion: string }
  job: { state: string; exitCode: number | null; logs: string }
}
export default function PanelSettings() {
  const { t } = useI18n()
  const [data, setData] = useState<Maintenance | null>(null)
  const [panelHost, setPanelHost] = useState('')
  const [mailHost, setMailHost] = useState('')
  const [ip, setIp] = useState('')
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState<'configure' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [newAddress, setNewAddress] = useState('')
  const [applying, setApplying] = useState<{ ticket: string; target: string; startedAt: number } | null>(null)
  const [applyProgress, setApplyProgress] = useState<MessageKey>('panelSettings.applyProgress')
  const [reconcile, setReconcile] = useState('')

  const load = useCallback(async (initialize = false) => {
    const res = await fetch('/api/v1/system/maintenance', { cache: 'no-store' })
    if (!res.ok) throw new Error(t('panelSettings.loadFailed'))
    const body = await res.json() as Maintenance
    setData(body)
    if (initialize) { setPanelHost(body.panelHost); setMailHost(body.mailHost); setIp(body.vpsIp) }
    return body
  }, [t])

  // 只有首次加载才用服务端值填输入框。切换语言会让 load 换身份并重新拉取
  // （提示文案要跟着语言走），但那时不能覆盖用户还没保存的编辑。
  const initialized = useRef(false)
  useEffect(() => {
    const first = !initialized.current
    initialized.current = true
    void load(first).catch((err) => setMessage({ ok: false, text: String(err) }))
  }, [load])
  useEffect(() => {
    if (applying) return
    if (!data || !['running', 'created'].includes(data.job.state)) return
    const timer = window.setInterval(() => { void load().catch(() => undefined) }, 3500)
    return () => window.clearInterval(timer)
  }, [data, load, applying])

  useEffect(() => {
    if (!applying) return
    let stopped = false
    let timer: number | undefined
    let controller: AbortController | undefined
    async function poll() {
      if (stopped || !applying) return
      if (Date.now() - applying.startedAt > 15 * 60_000) {
        setApplying(null)
        setMessage({ ok: false, text: t('panelSettings.applyTimeout') })
        return
      }
      try {
        let response: Response | undefined
        // The original address can report a rollback; the new address can report
        // success after the old hostname has stopped routing to the panel.
        const origins = [...new Set([window.location.origin, new URL(applying.target).origin])]
        for (const origin of origins) {
          if (stopped) return
          controller = new AbortController()
          const timeout = window.setTimeout(() => controller?.abort(), 6000)
          try {
            const statusUrl = new URL('/api/v1/system/maintenance/status', origin)
            statusUrl.searchParams.set('ticket', applying.ticket)
            const candidate = await fetch(statusUrl, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal })
            if ((candidate.ok || candidate.status === 403) && candidate.headers.get('content-type')?.includes('application/json')) {
              response = candidate
              break
            }
          } catch { /* The gateway may temporarily be unavailable during restart. */ }
          finally { window.clearTimeout(timeout) }
        }
        if (!response) throw new Error(t('panelSettings.serviceRestarting'))
        if (response.status === 403) {
          if (!stopped) {
            setApplying(null)
            setMessage({ ok: false, text: t('panelSettings.ticketExpired') })
          }
          return
        }
        if (!response.ok) throw new Error(t('panelSettings.serviceRestarting'))
        const status = await response.json() as { state: string; exitCode: number | null; ready: boolean; configured: boolean }
        if (stopped) return
        if (status.state === 'exited' && status.exitCode !== 0) {
          setApplying(null)
          setMessage({ ok: false, text: t('panelSettings.applyFailed') })
          void load().catch(() => undefined)
          return
        }
        if (status.ready) {
          setApplyProgress('panelSettings.applyProgressApplied')
          if (new URL(applying.target).origin === window.location.origin) window.location.reload()
          else window.location.assign(applying.target)
          return
        }
        setApplyProgress('panelSettings.applyProgress')
      } catch {
        if (!stopped) setApplyProgress('panelSettings.applyProgressReconnect')
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), 2500)
    }
    void poll()
    return () => { stopped = true; controller?.abort(); if (timer !== undefined) window.clearTimeout(timer) }
  }, [applying, load, t])

  async function saveIp() {
    setBusy('ip'); setMessage(null)
    try {
      const res = await fetch('/api/v1/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vpsIp: ip.trim() }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || t('panelSettings.saveFailed'))
      setMessage({ ok: true, text: t('panelSettings.ipSaved') }); await load()
    } catch (err) { setMessage({ ok: false, text: err instanceof Error ? err.message : t('panelSettings.saveFailed') }) }
    finally { setBusy('') }
  }

  async function execute(action: 'configure') {
    setBusy(action); setConfirm(null); setMessage(null); setNewAddress('')
    if (action === 'configure') setApplyProgress('panelSettings.applyProgressStarting')
    try {
      const res = await fetch('/api/v1/system/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, panelHost: panelHost.trim(), mailHost: mailHost.trim() }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || t('panelSettings.actionFailed'))
      if (action === 'configure') {
        const host = body.panelHost || panelHost.trim().toLowerCase()
        const target = new URL(window.location.pathname, host === window.location.hostname ? window.location.origin : `https://${host}`).href
        if (!body.ticket) throw new Error(t('panelSettings.ticketMissing'))
        setNewAddress(target)
        setApplyProgress('panelSettings.applyProgress')
        setApplying({ ticket: body.ticket, target, startedAt: Date.now() })
      } else setMessage({ ok: true, text: body.message || t('panelSettings.taskStarted') })
      await load().catch(() => undefined)
    } catch (err) { setMessage({ ok: false, text: err instanceof Error ? err.message : t('panelSettings.actionFailed') }) }
    finally { setBusy('') }
  }

  async function checkAccounts() {
    setReconcile(t('panelSettings.reconcileRunning'))
    try {
      const res = await fetch('/api/v1/system/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heal: false }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || t('panelSettings.reconcileFailed'))
      const missing = (body.mailboxes?.missing?.length || 0) + (body.rules?.missing?.length || 0)
      const extra = (body.mailboxes?.extra?.length || 0) + (body.rules?.extra?.length || 0)
      setReconcile(t('panelSettings.reconcileResult', { missing, extra }))
    } catch (err) { setReconcile(err instanceof Error ? err.message : t('panelSettings.reconcileFailed')) }
  }

  const running = data && ['running', 'created'].includes(data.job.state)
  const configuring = Boolean(applying) || busy === 'configure'
  const changed = data && (panelHost.trim() !== data.panelHost || mailHost.trim() !== data.mailHost)
  const memory = data?.host.memoryBytes ? `${(data.host.memoryBytes / 1024 ** 3).toFixed(1)} GB` : '—'
  return <main className="wrap panel-settings-page">
    <div className="topbar"><div><p className="eyebrow">CONTROL / SETTINGS</p><h1>{t('nav.panelTls')}</h1><p className="hint">{t('panelSettings.intro')}</p></div></div>
    {message && <div className={`msg ${message.ok ? 'ok' : 'err'}`} role="status">{message.text}{newAddress && <> {t('panelSettings.newAddress')}<a href={newAddress} target="_blank" rel="noreferrer">{newAddress}</a></>}</div>}
    {configuring && <div className="msg warn domain-apply-progress" role="status" aria-live="polite"><span className="domain-apply-spinner" aria-hidden="true"/><div><strong>{t(applyProgress)}</strong><p>{t('panelSettings.keepOpenHint')}</p></div></div>}
    <div className="panel-settings-overview">
      <section className="panel panel-identity" id="mail-host" aria-busy={configuring}><div className="section-title"><h2>{t('panelSettings.hostSection')}</h2><span className="count">{t('panelSettings.hostSectionCount')}</span></div>
        <p className="hint">{t('panelSettings.hostHint')}</p>
        <div className="panel-domain-fields"><label className="field">{t('panelSettings.panelDomainLabel')}<input value={panelHost} disabled={configuring} onChange={(event) => setPanelHost(event.target.value)} placeholder="panel.example.com" spellCheck={false} /></label>
          <label className="field">{t('panelSettings.mailHostLabel')}<input value={mailHost} disabled={configuring} onChange={(event) => setMailHost(event.target.value)} placeholder="mail.example.com" spellCheck={false} /></label></div>
        <div className="panel-setting-actions"><button type="button" className="primary domain-apply-button" disabled={!changed || Boolean(running) || Boolean(busy) || configuring} onClick={() => setConfirm('configure')}>{configuring && <span className="domain-apply-spinner" aria-hidden="true"/>}{configuring ? t('panelSettings.applying') : t('panelSettings.applyDomains')}</button><span className="hint-text">{t('panelSettings.mailHostHint')}</span></div>
      </section>
      <section className="panel panel-host"><div className="section-title"><h2>{t('panelSettings.hostInfoSection')}</h2><span className="count">{data?.host.architecture || t('panelSettings.reading')}</span></div>
        <dl className="host-facts"><div><dt>{t('panelSettings.osLabel')}</dt><dd>{data?.host.os || '—'}</dd></div><div><dt>{t('panelSettings.cpuMemoryLabel')}</dt><dd>{t('panelSettings.cpuMemoryValue', { cores: data?.host.cpus || '—', memory })}</dd></div><div><dt>{t('panelSettings.dockerLabel')}</dt><dd>{data?.host.dockerVersion || '—'}</dd></div><div><dt>{t('panelSettings.panelImageLabel')}</dt><dd className="mono">{data?.image || '—'}</dd></div></dl>
        <label className="field host-ip-field">{t('panelSettings.vpsIpLabel')}<input value={ip} onChange={(event) => setIp(event.target.value)} inputMode="decimal" placeholder="203.0.113.10" /></label>
        <div className="panel-setting-actions"><button type="button" disabled={configuring || busy === 'ip' || ip.trim() === data?.vpsIp} onClick={() => void saveIp()}>{busy === 'ip' ? t('common.saving') : t('panelSettings.saveIp')}</button></div>
      </section>
    </div>
    <CertificatesSection embedded />
    <section className="panel"><div className="section-title"><h2>{t('panelSettings.maintenanceSection')}</h2></div><p className="hint">{t('panelSettings.maintenanceHint')}</p>
      <div className="panel-maintenance-actions"><a className="btn-link" href="/api/v1/system/backup?what=db">{t('panelSettings.downloadDb')}</a><a className="btn-link" href="/api/v1/system/backup?what=dms-config">{t('panelSettings.downloadDms')}</a><button type="button" onClick={() => void checkAccounts()}>{t('panelSettings.checkAccounts')}</button></div>
      <BackupImports />
      {reconcile && <p className="hint" role="status">{reconcile}</p>}
      <MailArchiveManager />
    </section>
    <MigrationManager />
    {confirm && <div className="maintenance-confirm" role="dialog" aria-modal="true" aria-label={t('panelSettings.confirmDialogAria')}><div className="maintenance-confirm-card"><h2>{t('panelSettings.applyDomains')}</h2>
      <p>{t('panelSettings.confirmBody', { panelHost, mailHost })}</p>
      <div className="panel-maintenance-actions"><button type="button" onClick={() => setConfirm(null)}>{t('common.cancel')}</button><button type="button" className="primary" onClick={() => void execute(confirm)}>{t('panelSettings.confirmExecute')}</button></div></div></div>}
  </main>
}
