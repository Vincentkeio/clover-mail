'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

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
        setMsg({ ok: false, text: data.error ?? `未能保存（${response.status}）` })
        return false
      }

      const synced = data.routingSynced ?? (data.matchType === 'prefix' ? data.prefixSynced : data.dmsSynced)
      setMsg({
        ok: true,
        text: synced ? '已保存并应用到邮件服务。' : '已保存，但暂未同步到邮件服务；请检查服务状态。',
      })
      router.refresh()
      return true
    } catch {
      setMsg({ ok: false, text: '连接失败，请检查网络后重试。' })
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
    <div className="routing-mode-tabs" role="tablist" aria-label="选择邮件地址处理方式">
      <button className={`routing-mode-tab${mode === 'alias' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={mode === 'alias'} aria-controls="routing-alias-panel" onClick={() => { setMode('alias'); setMsg(null) }}>添加别名</button>
      <button className={`routing-mode-tab${mode === 'forward' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={mode === 'forward'} aria-controls="routing-forward-panel" onClick={() => { setMode('forward'); setMsg(null) }}>设置转发</button>
    </div>

    {mode === 'alias' ? <div id="routing-alias-panel" role="tabpanel" className="routing-mode-panel">
      <div className="routing-mode-copy">
        <h3>给现有邮箱增加一个收件地址</h3>
        <p>别人发给这个别名的邮件，会进入你选定的已有邮箱。别名不需要单独创建邮箱账号。</p>
      </div>
      {mailboxes.length ? <form className="routing-alias-form" onSubmit={submitAlias}>
        <label className="field">别名地址<div className="routing-alias-address">
          <input id="routing-alias-name" value={aliasName} onChange={(event) => setAliasName(event.target.value)} placeholder="例如 info" autoComplete="off" required pattern="[^@\s]+" title="只填写 @ 前面的地址部分" />
          <span>@{domainName}</span>
        </div></label>
        <label className="field" htmlFor="routing-alias-mailbox">邮件送到<select id="routing-alias-mailbox" value={mailbox} onChange={(event) => setMailbox(event.target.value)} required>
          {mailboxes.map((address) => <option key={address} value={address}>{address}</option>)}
        </select></label>
        <button className="primary" disabled={busy || !aliasName.trim()}>{busy ? '保存中…' : '添加别名'}</button>
        <p className="routing-howto">用法：想让别人发信到 <strong>info@{domainName}</strong>，别名填 <strong>info</strong>，再选择接收邮件的已有邮箱。</p>
      </form> : <div className="routing-empty-mailboxes"><p>还没有可接收邮件的邮箱。先创建一个邮箱账号，再回来添加别名。</p><Link href="/mailboxes">去创建邮箱 →</Link></div>}
    </div> : <div id="routing-forward-panel" role="tabpanel" className="routing-mode-panel">
      <div className="routing-mode-copy">
        <h3>按地址范围转发邮件</h3>
        <p>适合把一组地址或域名内未单独设置的来信，转到一个或多个收件地址。</p>
      </div>
      <form className="routing-forward-form" onSubmit={submitForward}>
        <label className="field" htmlFor="routing-forward-type">转发范围<select id="routing-forward-type" value={matchType} onChange={(event) => setMatchType(event.target.value as typeof matchType)}>
          <option value="prefix">按地址前缀转发</option>
          <option value="catchall">转发域名内其他来信</option>
        </select></label>
        {matchType === 'prefix' && <>
          <label className="field">地址前缀<div className="routing-prefix-address"><input id="routing-forward-prefix" value={matchValue} onChange={(event) => setMatchValue(event.target.value)} placeholder="例如 sales" required pattern="[^@\s]+" title="只填写地址前缀，不要输入 @ 或域名" /><span>*@{domainName}</span></div></label>
        </>}
        <label className="field" htmlFor="routing-forward-targets">转发到<input id="routing-forward-targets" value={targets} onChange={(event) => setTargets(event.target.value)} placeholder="一个或多个邮箱地址，用逗号分隔" required /></label>
        <label className="field routing-priority" htmlFor="routing-forward-priority">优先级<input id="routing-forward-priority" className="routing-priority-input" type="number" min="0" max="10000" value={priority} onChange={(event) => setPriority(event.target.value)} /></label>
        <button className="primary" disabled={busy || !targets.trim() || (matchType === 'prefix' && !matchValue.trim())}>{busy ? '保存中…' : '添加转发规则'}</button>
        <p className="routing-howto">用法：前缀规则如 <strong>sales*@{domainName}</strong>；“域名内其他来信”用于接收没有专属邮箱或规则的地址。多个匹配规则会合并投递给所有不同收件人，不会重复发送到同一个地址。多个目标请用逗号分开。</p>
      </form>
    </div>}
    {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.text}</div>}
  </div>
}
