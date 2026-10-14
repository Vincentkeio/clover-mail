import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, sql } from 'drizzle-orm'
import { db } from '@/db'
import { domains, routingRules } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function RoutingPage() {
  if (!await getCurrentAdmin()) redirect('/login')
  const [rows, counts] = await Promise.all([
    db.select().from(domains).orderBy(asc(domains.name)),
    db.select({ domainId: routingRules.domainId, total: sql<number>`count(*)` }).from(routingRules).groupBy(routingRules.domainId),
  ])
  const count = new Map(counts.map((item) => [item.domainId, Number(item.total)]))
  return <main className="wrap"><div className="topbar"><div><p className="eyebrow">MAIL / ROUTING</p><h1>别名与转发</h1><p className="hint">为每个域名配置别名、Catch-all 和外部转发规则。</p></div></div>
    <section className="panel"><div className="section-title"><h2>按域名管理</h2><span className="count">{rows.length} 个域名</span></div>
      {rows.length ? <div className="manual-dns-list">{rows.map((domain) => <div className="manual-dns-row" key={domain.id}><div><b className="mono">{domain.name}</b><p className="hint">{count.get(domain.id) || 0} 条规则</p></div><Link className="btn-link" href={`/domains/${domain.id}?tab=rules`}>管理规则 →</Link></div>)}</div>
        : <p className="empty">先在<Link href="/domains">域名配置</Link>添加域名。</p>}
    </section>
  </main>
}
