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

export default function RoutingManager({ domains, rules }: { domains: Domain[]; rules: Rule[] }) {
  const [domainId, setDomainId] = useState(domains.find((domain) => domain.active)?.id ?? domains[0]?.id ?? 0)
  const selected = domains.find((domain) => domain.id === domainId)
  const selectedRules = rules.filter((rule) => rule.domainId === domainId)

  return <main className="wrap">
    <div className="topbar"><div><p className="eyebrow">MAIL / ROUTING</p><h1>别名与转发</h1><p className="hint">别名是附加在域名上的收件地址（例如 sales@example.com），本身不单独存邮件；发到这里的邮件会转到已有邮箱。所有域名的规则都在此集中管理。</p></div></div>
    {domains.length ? <>
      <section className="panel">
        <div className="section-title"><div><h2>选择域名</h2><p className="hint">新增别名时，先选择它所属的域名。</p></div><span className="count">{domains.length} 个域名</span></div>
        <label className="field routing-domain-picker">域名<select value={domainId} onChange={(event) => setDomainId(Number(event.target.value))}>{domains.map((domain) => <option value={domain.id} key={domain.id}>{domain.name}{domain.active ? '' : '（已停用）'}</option>)}</select></label>
      </section>
      {selected && <>
        <section className="panel">
          <div className="section-title"><div><h2>添加规则</h2><p className="hint">例如把 sales@{selected.name} 转到你已有的邮箱地址。</p></div></div>
          {selected.active ? <RuleForm domainId={selected.id} domainName={selected.name} /> : <p className="msg warn">该域名已停用。请先在「DNS 与 TLS」中启用，再添加或同步规则。</p>}
        </section>
        <section className="panel">
          <div className="section-title"><div><h2>{selected.name} 的规则</h2><p className="hint">匹配到的邮件会送往规则指定的收件地址。</p></div><span className="count">{selectedRules.length} 条</span></div>
          {selectedRules.length ? <div className="table-scroll"><table className="grid"><thead><tr><th>类型</th><th>匹配地址</th><th>转发至</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead><tbody>{selectedRules.map((rule) => <tr key={rule.id}><td>{MATCH_TYPE_LABEL[rule.matchType] ?? rule.matchType}</td><td className="mono">{rule.matchValue ?? `@${selected.name}`}</td><td className="mono">{parseTargets(rule.targets).join(', ') || '—'}</td><td>{rule.priority}</td><td><span className={`tag ${rule.active ? 'ok' : 'err'}`}>{rule.active ? '启用' : '停用'}</span>{rule.matchType === 'prefix' && <> <span className="tag warn">DMS 下发待 M3</span></>}</td><td><DeleteButton url={`/api/v1/rules/${rule.id}`} confirmText="删除该规则？邮件服务中的对应别名也会一并清理。" /></td></tr>)}</tbody></table></div> : <p className="empty">该域名还没有转发规则。可在上方添加别名或 Catch-all。</p>}
        </section>
      </>}
    </> : <section className="panel"><p className="empty">还没有域名。请先到<Link href="/domains">域名配置</Link>添加域名。</p></section>}
  </main>
}
