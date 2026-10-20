'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

type Mode = 'alias' | 'forward'

export default function RuleForm({
  domainId,
  domainName,
  mailboxes,
}: {
  domainId: number
  domainName: string
  mailboxes: string[]
}) {
  const router = useRouter()
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('alias')
  const [aliasName, setAliasName] = useState('')
  const [mailbox, setMailbox] = useState(mailboxes[0] ?? '')
  const [matchType, setMatchType] = useState<'prefix' | 'catchall'>('prefix')
  const [matchValue, setMatchValue] = useState('')
  const [targets, setTargets] = useState('')
  const [priority, setPriority] = useState('100')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function createRule(payload: Record<string, unknown>) {
    setBusy(true)
    setMsg(null)
    try {
      const response = await fetch(`/api/v1/domains/${domainId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMsg({ ok: false, text: data.error ?? t('routing.saveFailedStatus', { status: response.status }) })
        return false
      }

      const synced = data.routingSynced ?? (data.matchType === 'prefix' ? data.prefixSynced : data.dmsSynced)
      setMsg({
        ok: true,
        text: synced ? t('routing.savedAndApplied') : t('routing.savedNotSynced'),
      })
      router.refresh()
      return true
    } catch {
      setMsg({ ok: false, text: t('routing.connectionFailed') })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submitAlias(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mailbox) return
    const created = await createRule({
      matchType: 'exact',
      matchValue: `${aliasName.trim()}@${domainName}`,
      targets: mailbox,
      priority: 100,
    })
    if (created) setAliasName('')
  }

  async function submitForward(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const created = await createRule({
      matchType,
      matchValue: matchType === 'prefix' ? matchValue.trim() : undefined,
      targets,
      priority: Number(priority),
    })
    if (created) {
      setMatchValue('')
      setTargets('')
    }
  }

  return <div className="routing-create">
    <div className="routing-mode-tabs" role="tablist" aria-label={t('routing.modeTabsAria')}>
      <button className={`routing-mode-tab${mode === 'alias' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={mode === 'alias'} aria-controls="routing-alias-panel" onClick={() => { setMode('alias'); setMsg(null) }}>{t('routing.addAlias')}</button>
      <button className={`routing-mode-tab${mode === 'forward' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={mode === 'forward'} aria-controls="routing-forward-panel" onClick={() => { setMode('forward'); setMsg(null) }}>{t('routing.setupForward')}</button>
    </div>

    {mode === 'alias' ? <div id="routing-alias-panel" role="tabpanel" className="routing-mode-panel">
      <div className="routing-mode-copy">
        <h3>{t('routing.aliasPanelTitle')}</h3>
        <p>{t('routing.aliasPanelDesc')}</p>
      </div>
      {mailboxes.length ? <form className="routing-alias-form" onSubmit={submitAlias}>
        <label className="field">{t('routing.aliasAddress')}<div className="routing-alias-address">
          <input id="routing-alias-name" value={aliasName} onChange={(event) => setAliasName(event.target.value)} placeholder={t('routing.aliasNamePlaceholder')} autoComplete="off" required pattern="[^@\s]+" title={t('routing.aliasNameTitle')} />
          <span>@{domainName}</span>
        </div></label>
        <label className="field" htmlFor="routing-alias-mailbox">{t('routing.deliverTo')}<select id="routing-alias-mailbox" value={mailbox} onChange={(event) => setMailbox(event.target.value)} required>
          {mailboxes.map((address) => <option key={address} value={address}>{address}</option>)}
        </select></label>
        <button className="primary" disabled={busy || !aliasName.trim()}>{busy ? t('common.saving') : t('routing.addAlias')}</button>
        <p className="routing-howto">{t('routing.aliasHowtoLead')}<strong>info@{domainName}</strong>{t('routing.aliasHowtoMid')}<strong>info</strong>{t('routing.aliasHowtoTail')}</p>
      </form> : <div className="routing-empty-mailboxes"><p>{t('routing.noMailboxes')}</p><Link href="/mailboxes">{t('routing.goCreateMailbox')}</Link></div>}
    </div> : <div id="routing-forward-panel" role="tabpanel" className="routing-mode-panel">
      <div className="routing-mode-copy">
        <h3>{t('routing.forwardPanelTitle')}</h3>
        <p>{t('routing.forwardPanelDesc')}</p>
      </div>
      <form className="routing-forward-form" onSubmit={submitForward}>
        <label className="field" htmlFor="routing-forward-type">{t('routing.forwardScope')}<select id="routing-forward-type" value={matchType} onChange={(event) => setMatchType(event.target.value as typeof matchType)}>
          <option value="prefix">{t('routing.scopePrefix')}</option>
          <option value="catchall">{t('routing.scopeCatchall')}</option>
        </select></label>
        {matchType === 'prefix' && <>
          <label className="field">{t('routing.prefixLabel')}<div className="routing-prefix-address"><input id="routing-forward-prefix" value={matchValue} onChange={(event) => setMatchValue(event.target.value)} placeholder={t('routing.prefixPlaceholder')} required pattern="[^@\s]+" title={t('routing.prefixTitle')} /><span>*@{domainName}</span></div></label>
        </>}
        <label className="field" htmlFor="routing-forward-targets">{t('routing.forwardTo')}<input id="routing-forward-targets" value={targets} onChange={(event) => setTargets(event.target.value)} placeholder={t('routing.targetsPlaceholder')} required /></label>
        <label className="field routing-priority" htmlFor="routing-forward-priority">{t('routing.priority')}<input id="routing-forward-priority" className="routing-priority-input" type="number" min="0" max="10000" value={priority} onChange={(event) => setPriority(event.target.value)} /></label>
        <button className="primary" disabled={busy || !targets.trim() || (matchType === 'prefix' && !matchValue.trim())}>{busy ? t('common.saving') : t('routing.addForwardRule')}</button>
        <p className="routing-howto">{t('routing.forwardHowtoLead')}<strong>sales*@{domainName}</strong>{t('routing.forwardHowtoTail')}</p>
      </form>
    </div>}
    {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.text}</div>}
  </div>
}
