'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

export default function NavLogout() {
  const router = useRouter()
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)

  async function onLogout() {
    setBusy(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
    router.refresh()
  }

  return (
    <button type="button" className="link" onClick={onLogout} disabled={busy}>
      {busy ? '…' : t('common.logout')}
    </button>
  )
}
