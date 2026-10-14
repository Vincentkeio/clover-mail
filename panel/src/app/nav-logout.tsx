'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function NavLogout() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onLogout() {
    setBusy(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
    router.refresh()
  }

  return (
    <button type="button" className="link" onClick={onLogout} disabled={busy}>
      {busy ? '…' : '登出'}
    </button>
  )
}
