import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, sql } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes, routingRules } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'
import DomainCreateForm from './domain-create-form'
import { getMailHostname } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export default async function DomainsPage() {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')

  const [rows, mbCounts, ruCounts] = await Promise.all([
    db.select().from(domains).orderBy(asc(domains.id)),
    db.select({ domainId: mailboxes.domainId, n: sql<number>`count(*)` }).from(mailboxes).groupBy(mailboxes.domainId),
    db.select({ domainId: routingRules.domainId, n: sql<number>`count(*)` }).from(routingRules).groupBy(routingRules.domainId),
  ])
  const mbMap = new Map(mbCounts.map((r) => [r.domainId, Number(r.n)]))
  const ruMap = new Map(ruCounts.map((r) => [r.domainId, Number(r.n)]))

  return (
    <main className="wrap">
      <div className="topbar"><div><p className="eyebrow">SETUP / 02</p><h1>域名配置</h1><p className="hint">添加邮件域名后生成 DNS 记录；所有域名共用面板设置中的邮件主机名和邮件服务证书。</p></div><span className="tag">{rows.length} 个域名</span></div>

      <section className="panel">
        <h2>添加域名</h2>
        <p className="hint">建域即可准备归属验证、MX、SPF、DKIM 与 DMARC。接下来到 DNS 与 TLS 页面完成检查。</p>
        <DomainCreateForm />
      </section>

      <section className="panel">
        {rows.length === 0 ? (
          <p className="empty">还没有域名，先在上方添加第一个。</p>
        ) : (
          <table className="grid domain-list-table">
            <thead>
              <tr>
                <th>域名</th>
                <th>邮件主机名</th>
                <th>邮箱</th>
                <th>规则</th>
                <th>归属验证 TXT</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/domains/${d.id}`}>{d.name}</Link>
                  </td>
                  <td className="mono">{getMailHostname(d.mailHostname || `mail.${d.name}`)}</td>
                  <td>{mbMap.get(d.id) ?? 0}</td>
                  <td>{ruMap.get(d.id) ?? 0}</td>
                  <td className="mono">{d.ownershipToken}</td>
                  <td>
                    <span className={'tag ' + (d.active ? 'ok' : 'err')}>{d.active ? '启用' : '停用'}</span>
                  </td>
                  <td>
                    <Link className="btn-link" href={`/domains/${d.id}`}>
                      管理
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
