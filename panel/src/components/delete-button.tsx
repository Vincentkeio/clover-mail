'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

export default function DeleteButton({
  url,
  label,
  confirmText,
  redirectTo,
}: {
  url: string
  label?: string
  confirmText?: string
  redirectTo?: string
}) {
  const router = useRouter()
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onDelete() {
    if (!window.confirm(confirmText ?? t('common.deleteConfirm'))) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(url, { method: 'DELETE' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || t('common.deleteFailed'))
      if (redirectTo) router.push(redirectTo)
      else router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('common.error'))
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span><button type="button" className="danger small" onClick={onDelete} disabled={busy}>
      {busy ? t('common.deleting') : (label ?? t('common.delete'))}
    </button>{error && <span className="domain-row-error" role="alert">{error}</span>}</span>
  )
}
