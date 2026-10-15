import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes, routingRules } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'
import MailboxForm, { MATCH_LABELS } from './mailbox-form'
import RuleForm from './rule-form'
import DnsPanel from './dns-panel'
import DeleteButton from '@/components/delete-button'
import MailSetupGuide from '@/components/mail-setup-guide'
import { DomainTabs } from '@/components/domain-tabs'
import { getMailHostname } from '@/lib/settings'

export const dynamic = 'force-dynamic'
const MATCH_TYPE_LABEL: Record<string, string> = { exact: '精确', prefix: '前缀', nonuser: '非用户', catchall: 'Catch-all' }
function parseTargets(json: string): string[] { try { const value = JSON.parse(json); return Array.isArray(value) ? value : [] } catch { return [] } }

export default async function DomainDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')
  const id = Number((await params).id)
  const requestedTab = (await searchParams).tab
  const initialTab = requestedTab === 'mailboxes' || requestedTab === 'rules' ? requestedTab : 'dns'
  if (!Number.isInteger(id)) notFound()
  const [domain] = await db.select().from(domains).where(eq(domains.id, id)).limit(1)
  if (!domain) notFound()
  const mailHostname = getMailHostname(domain.mailHostname || `mail.${domain.name}`)
  const [boxes, rules] = await Promise.all([
    db.select().from(mailboxes).where(eq(mailboxes.domainId, id)).orderBy(asc(mailboxes.id)),
    db.select().from(routingRules).where(eq(routingRules.domainId, id)).orderBy(asc(routingRules.priority), asc(routingRules.id)),
  ])
  return <main className="wrap">
    <div className="domain-heading"><div><Link href="/domains" className="back-link">← 域名列表</Link><div className="topbar"><h1>{domain.name}</h1><span className={'tag ' + (domain.active ? 'ok' : 'err')}>{domain.active ? '启用' : '停用'}</span></div></div><DeleteButton url={`/api/v1/domains/${domain.id}`} redirectTo="/domains" confirmText={`删除 ${domain.name}？请先处理其下邮箱和路由规则。`} /></div>
    <DomainTabs initialTab={initialTab}
      mailboxes={<div className="panel"><div className="section-title"><div><h2>邮箱账号</h2><p className="hint">在此域名下创建收件箱，并通过 Webmail 或邮件客户端登录。</p></div><span className="count">{boxes.length} 个</span></div><MailSetupGuide domainName={domain.name} mailHostname={mailHostname} /><MailboxForm domainId={domain.id} domainName={domain.name} />{boxes.length === 0 ? <p className="empty">还没有邮箱账号。</p> : <div className="table-scroll"><table className="grid"><thead><tr><th>地址</th><th>配额</th><th>状态</th><th>操作</th></tr></thead><tbody>{boxes.map((box) => <tr key={box.id}><td className="mono">{box.login}</td><td>{box.quotaMb ? `${box.quotaMb} MB` : '不限'}</td><td><span className={'tag ' + (box.active ? 'ok' : 'err')}>{box.active ? '启用' : '停用'}</span></td><td><DeleteButton url={`/api/v1/mailboxes/${box.id}`} confirmText={`删除 ${box.login}？DMS 侧账号会一并清理。`} /></td></tr>)}</tbody></table></div>}</div>}
      dns={<div className="domain-dns-content"><DnsPanel domainId={domain.id} domainName={domain.name} /><details className="advanced-details"><summary>高级选项 · 手动配置参考</summary><div className="advanced-body table-scroll"><table className="grid kv"><tbody><tr><td>统一邮件主机名</td><td className="mono">{mailHostname}</td></tr><tr><td>归属验证 TXT（@）</td><td className="mono">{domain.ownershipToken}</td></tr><tr><td>MX 记录</td><td className="mono">{mailHostname}.（优先级 10）</td></tr><tr><td>A 记录</td><td className="mono">{mailHostname} → VPS IP（在该主机名所属 DNS 区域维护）</td></tr></tbody></table></div></details></div>}
      rules={<div className="panel"><div className="section-title"><div><h2>邮件转发规则</h2><p className="hint">为别名、Catch-all 和外部转发设置匹配方式。</p></div><span className="count">{rules.length} 条</span></div><RuleForm domainId={domain.id} domainName={domain.name} />{rules.length === 0 ? <p className="empty">还没有转发规则。</p> : <div className="table-scroll"><table className="grid"><thead><tr><th>类型</th><th>匹配地址</th><th>转发至</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead><tbody>{rules.map((rule) => { const supported = rule.matchType !== 'prefix'; return <tr key={rule.id}><td>{MATCH_TYPE_LABEL[rule.matchType] ?? rule.matchType}</td><td className="mono">{rule.matchValue ?? `@${domain.name}`}</td><td className="mono">{parseTargets(rule.targets).join(', ')}</td><td>{rule.priority}</td><td><span className={'tag ' + (rule.active ? 'ok' : 'err')}>{rule.active ? '启用' : '停用'}</span>{!supported && <> <span className="tag warn">DMS 下发待 M3</span></>}</td><td><DeleteButton url={`/api/v1/rules/${rule.id}`} confirmText="删除该规则？DMS alias 会一并清理。" /></td></tr> })}</tbody></table></div>}</div>}
    />
  </main>
}
