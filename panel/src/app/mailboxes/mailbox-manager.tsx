'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import DeleteButton from '@/components/delete-button'

type Domain = { id: number; name: string; active: boolean }
type Mailbox = { id: number; domainId: number; login: string; active: boolean; quotaMb: number | null }

export default function MailboxManager({ domains, mailboxes, mailHost }: { domains: Domain[]; mailboxes: Mailbox[]; mailHost: string }) {
  const router = useRouter()
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
      if (!res.ok) throw new Error(body.error || '创建失败')
      if (!body.dmsSynced || !body.policySynced) {
        setLocal(''); setPassword(''); router.refresh()
        const problem = !body.dmsSynced
          ? '邮箱账号未能同步到邮件服务，请到环境检查查看邮件服务。'
          : `DMS 全局邮箱设置未能同步：${body.policyError || '请检查邮件服务状态。'}`
        setMessage({ ok: false, text: `账号 ${login} 已保存，但${problem}` })
        return
      }
      setLocal(''); setPassword('')
      setMessage({
        ok: body.listenersReady !== false,
        text: body.listenersReady === false
          ? `已创建 ${login}。${body.listenerMessage || '邮件端口尚未监听，请到环境检查查看原因。'}`
          : `已创建 ${login}。${body.listenerMessage || ''}`,
      })
      router.refresh()
    } catch (err) { setMessage({ ok: false, text: err instanceof Error ? err.message : '创建失败' }) }
    finally { setBusy(false) }
  }

  async function changePassword(id: number) {
    setBusy(true); setMessage(null)
    try {
      const res = await fetch(`/api/v1/mailboxes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: resetPassword }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || '修改密码失败')
      setResetId(null); setResetPassword(''); setMessage({ ok: true, text: '密码已更新，邮件客户端下次登录请使用新密码。' })
    } catch (err) { setMessage({ ok: false, text: err instanceof Error ? err.message : '修改密码失败' }) }
    finally { setBusy(false) }
  }

  return <main className="wrap mailbox-page">
    <div className="topbar"><div><p className="eyebrow">ACCOUNTS</p><h1>邮箱账户</h1><p className="hint">域名配置完成后，可直接创建任意地址并设置密码。一个域名只需配置一次 DNS。</p></div><span className="tag">{mailboxes.length} 个账户</span></div>
    <section className="panel"><div className="section-title"><div><h2>创建邮箱</h2><p className="hint">选择已导入域名，填写地址前缀和密码。</p></div></div>
      {activeDomains.length ? <form className="mailbox-create-form" onSubmit={create}>
        <label className="field">域名<select value={domainId} onChange={(event) => setDomainId(Number(event.target.value))}>{activeDomains.map((domain) => <option value={domain.id} key={domain.id}>{domain.name}</option>)}</select></label>
        <label className="field">邮箱前缀<input value={local} onChange={(event) => setLocal(event.target.value)} pattern="[A-Za-z0-9._+%-]+" required placeholder="name" autoComplete="off" /></label>
        <span className="mailbox-at" aria-hidden="true">@{selected?.name}</span>
        <label className="field">密码<input type="password" autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="至少 10 位" /></label>
        <button className="primary" disabled={busy}>{busy ? '创建中…' : '创建邮箱'}</button>
      </form> : <p className="empty">还没有可用域名。<Link href="/domains">先添加域名 →</Link></p>}
      {message && <p className={`msg ${message.ok ? 'ok' : 'err'}`} role="status">{message.text}</p>}
    </section>
    <section className="panel"><div className="section-title"><div><h2>客户端连接</h2><p className="hint">所有邮箱共用邮件主机和 TLS 证书。用户名填写完整邮箱地址，密码使用创建账户时设置的密码。</p></div><Link className="btn-link" href="/webmail">打开 Webmail →</Link></div><p><span className="mono">{mailHost || '尚未设置邮件主机'}</span> · IMAP TLS <b>993</b> · SMTP TLS <b>465</b> / STARTTLS <b>587</b></p></section>
    <section className="panel"><div className="section-title"><div><h2>现有账户</h2><p className="hint">协议、隐私和附件策略统一在全局邮箱设置中调整。</p></div><div className="mailbox-list-actions"><span className="count">{mailboxes.length} 个</span><Link className="btn-link" href="/settings#mail-policy">全局邮箱设置 →</Link></div></div>
      {mailboxes.length ? <div className="table-scroll"><table className="grid"><thead><tr><th>邮箱地址</th><th>域名</th><th>状态</th><th>管理</th></tr></thead><tbody>{mailboxes.map((box) => {
        const domain = domains.find((item) => item.id === box.domainId)
        return <tr key={box.id}><td className="mono">{box.login}</td><td>{domain?.name || '—'}</td><td><span className={`tag ${box.active ? 'ok' : 'err'}`}>{box.active ? '启用' : '停用'}</span></td><td className="mailbox-actions">
          <button type="button" onClick={() => { setResetId(resetId === box.id ? null : box.id); setResetPassword(''); setMessage(null) }}>改密码</button>
          <DeleteButton url={`/api/v1/mailboxes/${box.id}`} confirmText={`删除 ${box.login}？邮件服务账号会一并删除。`} />
          {resetId === box.id && <div className="mailbox-reset"><label className="field">新密码<input type="password" autoComplete="new-password" minLength={10} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="至少 10 位" /></label><button className="primary" type="button" disabled={busy || resetPassword.length < 10} onClick={() => void changePassword(box.id)}>保存新密码</button></div>}
        </td></tr>
      })}</tbody></table></div> : <p className="empty">尚无邮箱账户。创建后可在 Webmail 中打开。</p>}
    </section>
  </main>
}
