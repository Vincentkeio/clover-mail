'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function DeleteButton({
  url,
  label = '删除',
  confirmText = '确认删除？',
}: {
  url: string
  label?: string
  confirmText?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onDelete() {
    if (!window.confirm(confirmText)) return
    setBusy(true)
    await fetch(url, { method: 'DELETE' })
    setBusy(false)
    router.refresh()
  }

  return (
    <button type="button" className="danger small" onClick={onDelete} disabled={busy}>
      {busy ? '…' : label}
    </button>
  )
}
