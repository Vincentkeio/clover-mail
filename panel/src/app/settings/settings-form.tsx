'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/lib/i18n/client'
type SettingsShape = { vpsIp: string; dnsMode: 'cloudflare' | 'manual'; dmarcPolicy: 'none' | 'quarantine' | 'reject'; spfStrict: boolean; advancedDns: boolean }

export default function SettingsForm({ initial, advancedContent }: { initial: SettingsShape; advancedContent: React.ReactNode }) {
  const router = useRouter()
  const { t } = useI18n()
  const [dnsMode, setDnsMode] = useState(initial.dnsMode)
  const [dmarc, setDmarc] = useState(initial.dmarcPolicy)
  const [spfStrict, setSpfStrict] = useState(initial.spfStrict)
  const [advanced, setAdvanced] = useState(initial.advancedDns)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null)
    const body: Record<string, unknown> = { dnsMode, dmarcPolicy: dmarc, spfStrict, advancedDns: advanced }
    try {
      const res = await fetch('/api/v1/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg({ ok: false, text: data.error ?? t('settings.saveFailedStatus', { status: res.status }) }); return }
      setMsg({ ok: true, text: t('common.saved') }); router.refresh()
    } catch (error) { setMsg({ ok: false, text: String(error) }) }
    finally { setBusy(false) }
  }

  return <div className="settings-shell">
        <form className="panel settings-section" onSubmit={save}>
          <h2>{t('settings.manualTitle')}</h2><p className="hint">{t('settings.manualHint')}</p>
          <h3 className="settings-subhead" id="dns-mode">{t('settings.dnsParamsTitle')}</h3><div className="form-row"><div className="field"><label htmlFor="dns-mode-select">{t('settings.dnsModeLabel')}</label><select id="dns-mode-select" value={dnsMode} onChange={(e) => setDnsMode(e.target.value as typeof dnsMode)}><option value="cloudflare">{t('settings.dnsModeCloudflare')}</option><option value="manual">{t('settings.dnsModeManual')}</option></select></div><div className="field"><label htmlFor="dmarc-policy">{t('settings.dmarcPolicyLabel')}</label><select id="dmarc-policy" value={dmarc} onChange={(e) => setDmarc(e.target.value as typeof dmarc)}><option value="none">{t('settings.dmarcNone')}</option><option value="quarantine">quarantine</option><option value="reject">reject</option></select></div></div>
          <div className="form-row"><label className="check"><input type="checkbox" checked={!spfStrict} onChange={(e) => setSpfStrict(!e.target.checked)} />{t('settings.spfSoftLabel')}</label><label className="check"><input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />{t('settings.advancedDnsLabel')}</label></div>
          <div className="form-row"><button className="primary" disabled={busy}>{busy ? t('common.saving') : t('settings.saveAdvanced')}</button>{msg && <div role="status" className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}</div>
        </form>
        {advancedContent}
  </div>
}
