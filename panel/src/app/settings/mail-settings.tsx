'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/lib/i18n/client'
import type { GlobalMailSettings } from '@/lib/settings'

export default function GlobalMailSettings({ initial, mailHost }: { initial: GlobalMailSettings; mailHost: string }) {
  const router = useRouter()
  const { t } = useI18n()
  const [settings, setSettings] = useState(initial)
  const [unlimited, setUnlimited] = useState(initial.maxAttachmentMb === 0)
  const [finiteAttachmentMb, setFiniteAttachmentMb] = useState(String(initial.maxAttachmentMb || 100))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const parsedAttachmentMb = Number(finiteAttachmentMb)
    if (!unlimited && (!/^\d+$/.test(finiteAttachmentMb) || !Number.isInteger(parsedAttachmentMb) || parsedAttachmentMb < 1 || parsedAttachmentMb > 102400)) {
      setMessage({ ok: false, text: t('settings.attachmentInvalid') })
      return
    }
    setBusy(true); setMessage(null)
    try {
      const response = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, maxAttachmentMb: unlimited ? 0 : parsedAttachmentMb }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || t('settings.mailSaveFailed'))
      setSettings(data.mail)
      setUnlimited(data.mail.maxAttachmentMb === 0)
      if (data.mail.maxAttachmentMb > 0) setFiniteAttachmentMb(String(data.mail.maxAttachmentMb))
      setMessage({ ok: true, text: t('settings.mailSaved') })
      router.refresh()
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t('settings.mailSaveFailed') })
      const current = await fetch('/api/v1/settings', { cache: 'no-store' }).then((response) => response.json()).catch(() => null)
      if (current?.mail) {
        setSettings(current.mail)
        setUnlimited(current.mail.maxAttachmentMb === 0)
        if (current.mail.maxAttachmentMb > 0) setFiniteAttachmentMb(String(current.mail.maxAttachmentMb))
      }
      router.refresh()
    } finally { setBusy(false) }
  }

  function toggle(key: keyof GlobalMailSettings, checked: boolean) {
    setSettings((current) => ({ ...current, [key]: checked }))
  }

  return <section className="panel settings-section" id="mail-policy">
    <form onSubmit={save}>
      <fieldset className="global-mail-protocols">
        <legend>{t('settings.protocolsLegend')}</legend>
        <div className="form-row">
          <label className="check"><input type="checkbox" checked={settings.allowImap} onChange={(event) => toggle('allowImap', event.target.checked)} />{t('settings.protocolImap')}</label>
          <label className="check"><input type="checkbox" checked={settings.allowPop3} onChange={(event) => toggle('allowPop3', event.target.checked)} />{t('settings.protocolPop3')}</label>
          <label className="check"><input type="checkbox" checked={settings.allowSieve} onChange={(event) => toggle('allowSieve', event.target.checked)} />{t('settings.protocolSieve')}</label>
          <label className="check"><input type="checkbox" checked={settings.allowSmtp} onChange={(event) => toggle('allowSmtp', event.target.checked)} />{t('settings.protocolSmtp')}</label>
        </div>
        <p className="hint-text">{t('settings.protocolsHint')}</p>
      </fieldset>
      <fieldset className="mail-client-config">
        <legend>{t('settings.clientLegend')}</legend>
        <p className="hint-text">{t('settings.clientHint')}</p>
        {mailHost ? <p className="mail-client-host">{t('settings.clientHostLead')}<code>{mailHost}</code></p> : <p className="mail-client-host">{t('settings.noMailHost')}</p>}
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t('settings.clientTableAria')}>
          <table className="grid">
            <thead><tr><th scope="col">{t('settings.colPurpose')}</th><th scope="col">{t('settings.colProtocol')}</th><th scope="col">{t('settings.colPort')}</th><th scope="col">{t('settings.colEncryption')}</th></tr></thead>
            <tbody>
              <tr><th scope="row">{t('settings.rowIncomingRecommended')}</th><td>IMAP</td><td>993</td><td>SSL/TLS</td></tr>
              <tr><th scope="row">{t('settings.rowIncoming')}</th><td>POP3</td><td>995</td><td>SSL/TLS</td></tr>
              <tr><th scope="row">{t('settings.rowOutgoing')}</th><td>SMTP</td><td>465</td><td>SSL/TLS</td></tr>
              <tr><th scope="row">{t('settings.rowOutgoingAlt')}</th><td>SMTP</td><td>587</td><td>STARTTLS</td></tr>
            </tbody>
          </table>
        </div>
        <ul className="mail-client-steps">
          <li><strong>{t('settings.stepUsernameLabel')}</strong>{t('settings.stepUsernameText')}</li>
          <li><strong>{t('settings.stepPasswordLabel')}</strong>{t('settings.stepPasswordText')}</li>
          <li><strong>{t('settings.stepAuthLabel')}</strong>{t('settings.stepAuthText')}</li>
        </ul>
        <p className="hint-text">{t('settings.clientPortHint')}</p>
      </fieldset>
      <fieldset className="global-mail-content">
        <legend>{t('settings.contentLegend')}</legend>
        <label className="check"><input type="checkbox" checked={settings.allowExternalImages} onChange={(event) => toggle('allowExternalImages', event.target.checked)} />{t('settings.externalImagesLabel')}</label>
        <p className="hint-text">{t('settings.externalImagesHint')}</p>
        <div className="global-attachment-controls">
          <label className="field global-attachment-limit">{t('settings.attachmentLimitLabel')}<input type="number" min={1} max={102400} step={1} value={finiteAttachmentMb} disabled={unlimited} onChange={(event) => setFiniteAttachmentMb(event.target.value)} /></label>
          <label className="check global-attachment-unlimited"><input type="checkbox" checked={unlimited} onChange={(event) => {
            const checked = event.target.checked
            setUnlimited(checked)
            setSettings((current) => ({ ...current, maxAttachmentMb: checked ? 0 : (Number(finiteAttachmentMb) || 100) }))
          }} />{t('settings.unlimitedLabel')}</label>
        </div>
        <p className="hint-text">{t('settings.attachmentHint')}</p>
        <p className="hint-text">{t('settings.attachmentUnlimitedHint')}</p>
      </fieldset>
      <div className="form-row"><button className="primary" disabled={busy}>{busy ? t('settings.savingSynced') : t('settings.saveMailSettings')}</button>{message && <div role="status" className={'msg ' + (message.ok ? 'ok' : 'err')}>{message.text}</div>}</div>
    </form>
  </section>
}
