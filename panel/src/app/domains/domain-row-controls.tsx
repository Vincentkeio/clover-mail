'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Props = {
  id: number
  name: string
  active: boolean
  mailboxCount: number
  ruleCount: number
}

export default function DomainRowControls({ id, name, active, mailboxCount, ruleCount }: Props) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(active)
  const [busy, setBusy] = useState<'toggle' | 'delete' | null>(null)
  const [error, setError] = useState('')

  async function request(method: 'PATCH' | 'DELETE', body?: object) {
    const response = await fetch(`/api/v1/domains/${id}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || '操作失败，请稍后重试。')
    return result
  }

  async function toggle() {
    if (busy) return
    if (enabled && !window.confirm(`停用 ${name}？该域的客户端登录与发信将暂停，新邮件会被暂时拒收；重新启用后恢复。`)) return
    setBusy('toggle')
    setError('')
    try {
      await request('PATCH', { active: !enabled })
      setEnabled(!enabled)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '状态更改失败。')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (busy) return
    if (mailboxCount || ruleCount) {
      setError(`请先删除 ${mailboxCount} 个邮箱和 ${ruleCount} 条转发规则，再删除域名。`)
      return
    }
    if (!window.confirm(`确定删除 ${name}？Cloudflare DNS 记录不会自动删除。此操作无法撤销。`)) return
    setBusy('delete')
    setError('')
    try {
      const result = await request('DELETE')
      if (result.policySynced === false) setError(`域名已删除，但邮件服务策略未能同步：${result.policyError || '未知错误'}`)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败。')
    } finally {
      setBusy(null)
    }
  }

  return <>
    <td>
      <button type="button" className="link domain-status-switch" role="switch" aria-checked={enabled} aria-label={`${enabled ? '停用' : '启用'} ${name}`} onClick={toggle} disabled={busy !== null}>
        <span className="domain-switch-track" aria-hidden="true"><span className="domain-switch-thumb" /></span>
        <span>{busy === 'toggle' ? '应用中…' : enabled ? '启用' : '停用'}</span>
      </button>
      {error && <p className="domain-row-error" role="alert">{error}</p>}
    </td>
    <td>
      <div className="domain-row-actions">
        <Link className="btn-link" href={`/domains/${id}`}>管理</Link>
        <button type="button" className="danger" onClick={remove} disabled={busy !== null}>{busy === 'delete' ? '删除中…' : '删除'}</button>
      </div>
    </td>
  </>
}
