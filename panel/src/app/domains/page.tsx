import { asc, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { domains, mailboxes, routingRules } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'
import { getMailHostname } from '@/lib/settings'
import DomainCreateForm from '../environment/domain-create-form'
import DomainListControls from './domain-list-controls'

export const dynamic = 'force-dynamic'

export default async function DomainsPage() {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')

  const [rows, mbCounts, ruCounts] = await Promise.all([
    db.select().from(domains).orderBy(asc(domains.id)),
    db.select({ domainId: mailboxes.domainId, n: sql<number>`count(*)` }).from(mailboxes).groupBy(mailboxes.domainId),
    db.select({ domainId: routingRules.domainId, n: sql<number>`count(*)` }).from(routingRules).groupBy(routingRules.domainId),
  ])
  const mbMap = new Map(mbCounts.map((row) => [row.domainId, Number(row.n)]))
  const ruMap = new Map(ruCounts.map((row) => [row.domainId, Number(row.n)]))

  return <main className="wrap">
    <div className="topbar"><div><p className="eyebrow">SETUP / 02</p><h1>域名配置</h1><p className="hint">添加邮件域名、查看归属验证信息，并管理域名启用状态。DNS 记录请到“DNS 与 TLS”管理。</p></div><span className="tag">{rows.length} 个域名</span></div>
    <section className="panel">
      <h2>添加域名</h2>
      <p className="hint">添加后可在“DNS 与 TLS”中生成、同步并检查 MX、SPF、DKIM 与 DMARC 记录。</p>
      <DomainCreateForm />
    </section>
    <section className="panel">
      {rows.length === 0 ? <p className="empty">还没有域名，先在上方添加第一个。</p> : <div className="table-scroll"><table className="grid domain-list-table">
        <thead><tr><th>域名</th><th>邮件主机名</th><th>邮箱</th><th>规则</th><th>归属验证 TXT</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>{rows.map((domain) => <tr key={domain.id}>
          <td><span className="mono">{domain.name}</span></td>
          <td className="mono">{getMailHostname(domain.mailHostname || `mail.${domain.name}`)}</td>
          <td>{mbMap.get(domain.id) ?? 0}</td>
          <td>{ruMap.get(domain.id) ?? 0}</td>
          <td className="mono">{domain.ownershipToken}</td>
          <DomainListControls id={domain.id} name={domain.name} active={domain.active} mailboxCount={mbMap.get(domain.id) ?? 0} ruleCount={ruMap.get(domain.id) ?? 0} />
        </tr>)}</tbody>
      </table></div>}
    </section>
  </main>
}
