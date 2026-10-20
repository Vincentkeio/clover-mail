'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'
import type { Translator } from '@/lib/i18n/translate'

type Probe = {
  host: string; port: number; ok: boolean; installed?: boolean; authorized?: boolean; subject?: string; issuer?: string
  validFrom?: string; validTo?: string; daysLeft?: number; fingerprint?: string; error?: string
}
type CertificateData = { checkedAt: string; panelHost: string; mailHost: string; checks: Probe[]; certificateTask?: { running: boolean; message: string; error: string | null; updatedAt?: string } | null; renewal?: { enabled: boolean; manager: string; challenge: string; ports: number[]; acmeEmail: string | null }; error?: string }

function date(value: string | undefined, dateLocale: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(dateLocale, { dateStyle: 'medium', timeStyle: 'short' })
}

function state(probe: Probe | undefined, t: Translator) {
  if (!probe) return { label: t('certificates.stateNotChecked'), style: 'warn' }
  if (probe.installed === false) return { label: t('certificates.stateNotInstalled'), style: 'warn' }
  if (!probe.validTo) return { label: probe.error ? t('certificates.stateUnavailable') : t('certificates.stateNotChecked'), style: 'warn' }
  if ((probe.daysLeft ?? -1) < 0) return { label: t('certificates.stateExpired'), style: 'err' }
  if (probe.authorized === false) return { label: t('certificates.stateChainError'), style: 'warn' }
  if ((probe.daysLeft ?? 999) <= 14) return { label: t('certificates.stateExpiring'), style: 'warn' }
  return { label: t('certificates.stateValid'), style: 'ok' }
}

export function CertificatesSection({ embedded = false }: { embedded?: boolean }) {
  const { t, dateLocale } = useI18n()
  const [data, setData] = useState<CertificateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionTarget, setActionTarget] = useState<'panel' | 'mail' | null>(null)
  const [actionMessage, setActionMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/certificates', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t('certificates.statusLoadFailed'))
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('certificates.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  async function issueOrRenew(target: 'panel' | 'mail') {
    setActionTarget(target)
    setActionMessage('')
    setError('')
    try {
      const response = await fetch('/api/certificates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t('certificates.issueFailed'))
      setActionMessage(payload.message || t('certificates.statusUpdated'))
      if (target === 'mail' && payload.running) {
        const deadline = Date.now() + 9 * 60 * 1000
        const queuedAt = Date.parse(payload.queuedAt || new Date().toISOString())
        let taskStarted = false
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 2000))
          let statusResponse: Response
          try {
            statusResponse = await fetch('/api/certificates', { cache: 'no-store' })
          } catch {
            // Automatic certificate provisioning may finish after the first TLS probe.
            continue
          }
          if (!statusResponse.ok) continue
          const statusPayload = await statusResponse.json() as CertificateData
          setData(statusPayload)
          const task = statusPayload.certificateTask
          const startedAt = task?.updatedAt ? Date.parse(task.updatedAt) : 0
          taskStarted ||= Boolean(task?.running) || startedAt >= queuedAt
          if (task?.message && task.running) setActionMessage(task.message)
          if (taskStarted && task && !task.running) {
            if (task.error) throw new Error(task.error)
            setActionMessage(task.message || t('certificates.mailIssued'))
            return
          }
        }
        throw new Error(t('certificates.mailTaskRunning'))
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('certificates.issueRetry'))
    } finally { setActionTarget(null) }
  }

  useEffect(() => { void load() }, [load])

  const panel = data?.checks.find((item) => item.port === 443)
  const mail = data?.checks.find((item) => item.port === 465)

  return <div className="wrap certificate-page" id={embedded ? 'tls' : undefined}>
    <div className="topbar certificate-heading">
      <div>{embedded ? <h2>{t('certificates.titleEmbedded')}</h2> : <h1>{t('certificates.title')}</h1>}<p className="hint">{t('certificates.intro')}</p></div>
      <button type="button" onClick={() => void load()} disabled={loading}>{loading ? t('certificates.checking') : t('certificates.recheck')}</button>
    </div>

    {error && <div className="banner" role="alert">{error}</div>}
    {data?.error && <div className="banner" role="alert">{data.error}</div>}

    <section className="certificate-list" aria-label={t('certificates.listAria')}>
      <CertificateCard title={t('certificates.panelCardTitle')} host={data?.panelHost} probe={panel} kind="caddy" loading={loading && !data} actionBusy={actionTarget === 'panel'} onAction={() => void issueOrRenew('panel')} />
      <CertificateCard title={t('certificates.mailCardTitle')} host={data?.mailHost} probe={mail} kind="mail" loading={loading && !data} actionBusy={actionTarget === 'mail'} onAction={() => void issueOrRenew('mail')} />
    </section>

    {actionMessage && <p className="certificate-action-message" role="status">{actionMessage}</p>}

      <section className="panel certificate-settings">
      <div className="section-title"><div><h2>{t('certificates.renewalTitle')}</h2><p className="hint">{t('certificates.renewalHint')}</p></div><span className="tag ok">{t('certificates.renewalEnabled')}</span></div>
      <dl className="certificate-settings-grid">
        <div><dt>{t('certificates.managerLabel')}</dt><dd>{data?.renewal?.manager || t('certificates.managerFallback')}</dd></div>
        <div><dt>{t('certificates.challengeLabel')}</dt><dd>{data?.renewal?.challenge || 'HTTP-01 / TLS-ALPN-01'}</dd></div>
        <div><dt>{t('certificates.portsLabel')}</dt><dd>{data?.renewal?.ports?.join(' / ') || '80 / 443'}</dd></div>
        <div><dt>{t('certificates.acmeEmailLabel')}</dt><dd>{data?.renewal?.acmeEmail || t('certificates.acmeEmailFallback')}</dd></div>
      </dl>
      <p className="hint certificate-settings-hint">{t('certificates.issueHint')}</p>
    </section>

      <section className="certificate-note">
      <span className="certificate-note-mark" aria-hidden="true">i</span>
      <div><b>{t('certificates.noteTitle')}</b><p>{t('certificates.noteBody')}</p></div>
    </section>

    <p className="certificate-updated">{data?.checkedAt ? t('certificates.lastChecked', { time: date(data.checkedAt, dateLocale) }) : t('certificates.neverChecked')}</p>
  </div>
}


function CertificateCard({ title, host, probe, kind, loading, actionBusy, onAction }: { title: string; host?: string; probe?: Probe; kind: 'caddy' | 'mail'; loading: boolean; actionBusy: boolean; onAction: () => void }) {
  const { t, dateLocale } = useI18n()
  const current = state(probe, t)
  return <section className="panel certificate-card" id={kind === 'mail' ? 'tls-mail' : 'tls-panel'}>
    <div className="certificate-card-top">
      <div><p className="certificate-label">{kind === 'caddy' ? 'WEB PANEL · ACME' : 'MAIL SERVICES · ACME'}</p><h2>{title}</h2><code className="certificate-host">{host || t('certificates.hostMissing')}</code></div>
      <span className={`tag ${loading ? '' : current.style}`}>{loading ? t('certificates.checkingShort') : current.label}</span>
    </div>
    <div className="certificate-card-action"><span className="hint-text">{host ? t('certificates.renewalEnabled') : t('certificates.renewalPending')}</span><button type="button" onClick={onAction} disabled={actionBusy || loading || !host}>{actionBusy ? t('certificates.issuing') : t('certificates.issueAction')}</button></div>
    {probe?.validTo ? <dl className="certificate-details">
      <div><dt>{t('certificates.daysLeftLabel')}</dt><dd className={probe.daysLeft !== undefined && probe.daysLeft <= 14 ? 'is-expiring' : ''}>{t('certificates.daysLeft', { days: probe.daysLeft ?? '—' })}</dd></div>
      <div><dt>{t('certificates.expiresAtLabel')}</dt><dd>{date(probe.validTo, dateLocale)}</dd></div>
      <div><dt>{t('certificates.issuerLabel')}</dt><dd>{probe.issuer || t('common.unknown')}</dd></div>
      <div><dt>{t('certificates.subjectLabel')}</dt><dd>{probe.subject || host || t('common.unknown')}</dd></div>
    </dl> : <div className="certificate-empty">{loading ? t('certificates.reading') : probe?.error || (kind === 'mail' && !host ? t('certificates.mailHostMissing') : t('certificates.connectFailed'))}</div>}
    {probe?.error && probe.validTo && <p className="certificate-error">{t('certificates.chainWarning', { error: probe.error })}</p>}
    {probe?.fingerprint && <details className="certificate-fingerprint"><summary>{t('certificates.showFingerprint')}</summary><code>{probe.fingerprint}</code></details>}
  </section>
}
