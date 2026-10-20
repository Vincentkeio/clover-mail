'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

type Props = { id: number; name: string; active: boolean; mailboxCount: number; ruleCount: number }

export default function DomainListControls({ id, name, active, mailboxCount, ruleCount }: Props) {
  const router = useRouter()
  const { t } = useI18n()
  const [enabled, setEnabled] = useState(active)
  const [busy, setBusy] = useState<'toggle' | 'delete' | null>(null)
  const [error, setError] = useState('')

  async function request(method: 'PATCH' | 'DELETE', body?: object) {
    const response = await fetch(`/api/v1/domains/${id}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || t('domains.requestFailed'))
    return result
  }

  async function toggle() {
    if (busy) return
    if (enabled && !window.confirm(t('domains.confirmDisable', { name }))) return
    setBusy('toggle')
    setError('')
    try {
      await request('PATCH', { active: !enabled })
      setEnabled(!enabled)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('domains.toggleFailed'))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (busy) return
    if (!window.confirm(t('domains.confirmDelete', { name, mailboxes: mailboxCount, rules: ruleCount }))) return
    setBusy('delete')
    setError('')
    try {
      const result = await request('DELETE')
      if (result.policySynced === false) setError(t('domains.policySyncFailed', { error: result.policyError || t('common.unknown') }))
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('domains.deleteFailed'))
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return <>
    <td><button type="button" className="link domain-status-switch" role="switch" aria-checked={enabled} aria-label={enabled ? t('domains.disableAria', { name }) : t('domains.enableAria', { name })} onClick={toggle} disabled={busy !== null}>
      <span className="domain-switch-track" aria-hidden="true"><span className="domain-switch-thumb" /></span>
      <span>{busy === 'toggle' ? t('domains.applying') : enabled ? t('common.active') : t('common.inactive')}</span>
    </button>{error && <p className="domain-row-error" role="alert">{error}</p>}</td>
    <td><div className="domain-row-actions"><button type="button" className="danger" onClick={remove} disabled={busy !== null}>{busy === 'delete' ? t('domains.deleting') : t('common.delete')}</button></div></td>
  </>
}
