'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function DeleteButton({
  url,
  label = '删除',
  confirmText = '确认删除？',
  redirectTo,
}: {
  url: string
  label?: string
  confirmText?: string
  redirectTo?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onDelete() {
    if (!window.confirm(confirmText)) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(url, { method: 'DELETE' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || '删除失败，请稍后重试。')
      if (redirectTo) router.push(redirectTo)
      else router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span><button type="button" className="danger small" onClick={onDelete} disabled={busy}>
      {busy ? '删除中…' : label}
    </button>{error && <span className="domain-row-error" role="alert">{error}</span>}</span>
  )
}
