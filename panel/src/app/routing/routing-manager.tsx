'use client'

import Link from 'next/link'
import { useState } from 'react'
import DeleteButton from '@/components/delete-button'
import RuleForm from './rule-form'

type Domain = { id: number; name: string; active: boolean }
type Rule = { id: number; domainId: number; matchType: string; matchValue: string | null; targets: string; priority: number; active: boolean }

const MATCH_TYPE_LABEL: Record<string, string> = { exact: '精确地址', prefix: '前缀匹配', nonuser: '非用户地址', catchall: 'Catch-all' }

function parseTargets(json: string): string[] {
  try { const value: unknown = JSON.parse(json); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
  catch { return [] }
}

export default function RoutingManager({ domains, rules, mailboxes }: { domains: Domain[]; rules: Rule[]; mailboxes: string[] }) {
  const [domainId, setDomainId] = useState(domains.find((domain) => domain.active)?.id ?? domains[0]?.id ?? 0)
  const selected = domains.find((domain) => domain.id === domainId)
  const selectedRules = rules.filter((rule) => rule.domainId === domainId)

  return <main className="wrap">
    <div className="topbar"><div><p className="eyebrow">MAIL / ROUTING</p><h1>别名与转发</h1><p className="hint">别名给现有邮箱增加一个新地址；转发规则则按地址范围分流邮件。先选域名，再按下面的说明添加。</p></div></div>
    {domains.length ? <>
      <section className="panel">
        <div className="section-title"><div><h2>选择域名</h2><p className="hint">别名地址和转发规则都属于一个邮件域名。</p></div><span className="count">{domains.length} 个域名</span></div>
        <label className="field routing-domain-picker">域名<select value={domainId} onChange={(event) => setDomainId(Number(event.target.value))}>{domains.map((domain) => <option value={domain.id} key={domain.id}>{domain.name}{domain.active ? '' : '（已停用）'}</option>)}</select></label>
      </section>
      {selected && <>
        <section className="panel">
          <div className="section-title"><div><h2>添加别名或设置转发</h2><p className="hint">别名用于一个具体地址；转发用于前缀或域名内其他来信。</p></div></div>
          {selected.active ? <RuleForm domainId={selected.id} domainName={selected.name} mailboxes={mailboxes} /> : <p className="msg warn">该域名已停用。请先在「DNS 设置」中启用，再添加或同步规则。</p>}
        </section>
        <section className="panel">
          <div className="section-title"><div><h2>{selected.name} 的规则</h2><p className="hint">匹配到的邮件会送往规则指定的收件地址。</p></div><span className="count">{selectedRules.length} 条</span></div>
          {selectedRules.length ? <div className="table-scroll"><table className="grid"><thead><tr><th>类型</th><th>匹配地址</th><th>转发至</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead><tbody>{selectedRules.map((rule) => <tr key={rule.id}><td>{MATCH_TYPE_LABEL[rule.matchType] ?? rule.matchType}</td><td className="mono">{rule.matchType === 'prefix' ? `${rule.matchValue}*@${selected.name}` : rule.matchValue ?? `@${selected.name}`}</td><td className="mono">{parseTargets(rule.targets).join(', ') || '—'}</td><td>{rule.priority}</td><td><span className={`tag ${rule.active ? 'ok' : 'err'}`}>{rule.active ? '启用' : '停用'}</span></td><td><DeleteButton url={`/api/v1/rules/${rule.id}`} confirmText="删除该规则？邮件服务中的对应别名也会一并清理。" /></td></tr>)}</tbody></table></div> : <p className="empty">该域名还没有规则。可以添加一个别名，或设置范围转发。</p>}
        </section>
      </>}
    </> : <section className="panel"><p className="empty">还没有域名。请先到<Link href="/domains">域名配置</Link>添加域名。</p></section>}
  </main>
}
