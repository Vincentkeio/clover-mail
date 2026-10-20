'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

export default function DomainCreateForm({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter()
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/v1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? t('environment.createFailed', { status: res.status }) })
      return
    }
    setName('')
    setMsg({
      ok: true,
      text: data.dmsSynced
        ? t('environment.createSynced', { name: data.name })
        : t('environment.createPendingSync', { name: data.name }),
    })
    onCreated?.()
    router.refresh()
  }

  return (
    <form className="form-row" onSubmit={onSubmit}>
      <div className="field">
        <label>{t('common.domain')}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="example.com"
          required
        />
      </div>
      <button className="primary" disabled={busy}>
        {busy ? t('environment.submitting') : t('environment.addDomain')}
      </button>
      {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
    </form>
  )
}
