'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import DeleteButton from '@/components/delete-button'
import { useI18n } from '@/lib/i18n/client'

type Domain = { id: number; name: string; active: boolean }
type Mailbox = { id: number; domainId: number; login: string; active: boolean; quotaMb: number | null }

export default function MailboxManager({ domains, mailboxes, mailHost }: { domains: Domain[]; mailboxes: Mailbox[]; mailHost: string }) {
  const router = useRouter()
  const { t } = useI18n()
  const activeDomains = domains.filter((domain) => domain.active)
  const [domainId, setDomainId] = useState(activeDomains[0]?.id || 0)
  const [local, setLocal] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [resetId, setResetId] = useState<number | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const selected = domains.find((domain) => domain.id === domainId)

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) return
    setBusy(true); setMessage(null)
    try {
      const login = `${local.trim().toLowerCase()}@${selected.name}`
      const res = await fetch(`/api/v1/domains/${selected.id}/mailboxes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || t('mailboxes.createFailed'))
      if (!body.dmsSynced || !body.policySynced) {
        setLocal(''); setPassword(''); router.refresh()
        const text = !body.dmsSynced
          ? t('mailboxes.dmsNotSynced', { login })
          : t('mailboxes.policySyncFailed', { login, error: body.policyError || t('mailboxes.checkMailService') })
        setMessage({ ok: false, text })
        return
      }
      setLocal(''); setPassword('')
      setMessage({
        ok: body.listenersReady !== false,
        text: body.listenersReady === false
          ? t('mailboxes.createdWithNote', { login, note: body.listenerMessage || t('mailboxes.listenerNotReady') })
          : body.listenerMessage
            ? t('mailboxes.createdWithNote', { login, note: body.listenerMessage })
            : t('mailboxes.created', { login }),
      })
      router.refresh()
    } catch (err) { setMessage({ ok: false, text: err instanceof Error ? err.message : t('mailboxes.createFailed') }) }
    finally { setBusy(false) }
  }

  async function changePassword(id: number) {
    setBusy(true); setMessage(null)
    try {
      const res = await fetch(`/api/v1/mailboxes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: resetPassword }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || t('mailboxes.passwordChangeFailed'))
      setResetId(null); setResetPassword(''); setMessage({ ok: true, text: t('mailboxes.passwordChanged') })
    } catch (err) { setMessage({ ok: false, text: err instanceof Error ? err.message : t('mailboxes.passwordChangeFailed') }) }
    finally { setBusy(false) }
  }

  return <main className="wrap mailbox-page">
    <div className="topbar"><div><p className="eyebrow">ACCOUNTS</p><h1>{t('mailboxes.title')}</h1><p className="hint">{t('mailboxes.intro')}</p></div><span className="tag">{t('mailboxes.countAccounts', { count: mailboxes.length })}</span></div>
    <section className="panel"><div className="section-title"><div><h2>{t('mailboxes.createTitle')}</h2><p className="hint">{t('mailboxes.createHint')}</p></div></div>
      {activeDomains.length ? <form className="mailbox-create-form" onSubmit={create}>
        <label className="field">{t('common.domain')}<select value={domainId} onChange={(event) => setDomainId(Number(event.target.value))}>{activeDomains.map((domain) => <option value={domain.id} key={domain.id}>{domain.name}</option>)}</select></label>
        <label className="field">{t('mailboxes.prefixLabel')}<input value={local} onChange={(event) => setLocal(event.target.value)} pattern="[A-Za-z0-9._+%-]+" required placeholder="name" autoComplete="off" /></label>
        <span className="mailbox-at" aria-hidden="true">@{selected?.name}</span>
        <label className="field">{t('common.password')}<input type="password" autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required placeholder={t('mailboxes.passwordMinPlaceholder')} /></label>
        <button className="primary" disabled={busy}>{busy ? t('mailboxes.creating') : t('mailboxes.create')}</button>
      </form> : <p className="empty">{t('mailboxes.noDomain')}<Link href="/domains">{t('mailboxes.addDomainFirst')}</Link></p>}
      {message && <p className={`msg ${message.ok ? 'ok' : 'err'}`} role="status">{message.text}</p>}
    </section>
    <section className="panel"><div className="section-title"><div><h2>{t('mailboxes.clientTitle')}</h2><p className="hint">{t('mailboxes.clientHint')}</p></div></div><p><span className="mono">{mailHost || t('mailboxes.mailHostMissing')}</span> · IMAP TLS <b>993</b> · SMTP TLS <b>465</b> / STARTTLS <b>587</b></p></section>
    <section className="panel"><div className="section-title"><div><h2>{t('mailboxes.existingTitle')}</h2><p className="hint">{t('mailboxes.existingHint')}</p></div><div className="mailbox-list-actions"><span className="count">{t('mailboxes.countItems', { count: mailboxes.length })}</span></div></div>
      {mailboxes.length ? <div className="table-scroll"><table className="grid"><thead><tr><th>{t('mailboxes.colLogin')}</th><th>{t('common.domain')}</th><th>{t('common.status')}</th><th>{t('mailboxes.colManage')}</th></tr></thead><tbody>{mailboxes.map((box) => {
        const domain = domains.find((item) => item.id === box.domainId)
        return <tr key={box.id}><td className="mono">{box.login}</td><td>{domain?.name || '—'}</td><td><span className={`tag ${box.active ? 'ok' : 'err'}`}>{box.active ? t('common.active') : t('common.inactive')}</span></td><td className="mailbox-actions">
          <div className="mailbox-action-buttons"><button type="button" onClick={() => { setResetId(resetId === box.id ? null : box.id); setResetPassword(''); setMessage(null) }}>{t('mailboxes.changePassword')}</button>
          <DeleteButton url={`/api/v1/mailboxes/${box.id}`} confirmText={t('mailboxes.confirmDelete', { login: box.login })} /></div>
          {resetId === box.id && <div className="mailbox-reset"><label className="field">{t('mailboxes.newPassword')}<input type="password" autoComplete="new-password" minLength={10} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder={t('mailboxes.passwordMinPlaceholder')} /></label><button className="primary" type="button" disabled={busy || resetPassword.length < 10} onClick={() => void changePassword(box.id)}>{t('mailboxes.saveNewPassword')}</button></div>}
        </td></tr>
      })}</tbody></table></div> : <p className="empty">{t('mailboxes.empty')}</p>}
    </section>
  </main>
}
