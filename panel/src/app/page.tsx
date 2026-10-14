import Link from 'next/link'
import { desc, sql } from 'drizzle-orm'
import { db } from '@/db'
import { auditLogs, dnsRecords, domains, mailboxes, routingRules } from '@/db/schema'
import { supervisorStatus } from '@/lib/dms'

export const dynamic = 'force-dynamic'

const count = async (table: Parameters<typeof db.select>[0] extends never ? never : any): Promise<number> => {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(table)
  return Number(row.n)
}

const ACTION_LABELS: Record<string, string> = {
  'domain.create': '建域',
  'domain.delete': '删域',
  'mailbox.create': '建邮箱',
  'mailbox.delete': '删邮箱',
  'rule.create': '建规则',
  'rule.delete': '删规则',
  'dns.generate': '生成 DNS',
  'dns.push': '推送 CF',
  'dns.check': 'DNS 检测',
  'roundcube.open': 'Roundcube 登录',
  'settings.update': '改设置',
  'auth.login': '登录面板',
  'system.reconcile': '对账',
  'seed': '种子',
}

function label(action: string): string {
  return ACTION_LABELS[action] ?? action
}

export default async function Dashboard() {
  const [domainCount, mailboxCount, ruleCount, dnsCount, dnsPushed, logCount, dms, recentLogs, domainRows] =
    await Promise.all([
      count(domains),
      count(mailboxes),
      count(routingRules),
      count(dnsRecords),
      db
        .select({ n: sql<number>`count(*)` })
        .from(dnsRecords)
        .where(sql`${dnsRecords.status} = 'pushed'`)
        .then((r) => Number(r[0]?.n ?? 0)),
      count(auditLogs),
      supervisorStatus().then((r) =>
        r.ok ? { state: 'up' as const, detail: r.stdout } : { state: 'down' as const, detail: r.error.slice(0, 200) },
      ),
      db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(8),
      db.select({ id: domains.id, name: domains.name }).from(domains).orderBy(desc(domains.id)).limit(3),
    ])

  const stats: Array<[string, number]> = [
    ['域名', domainCount],
    ['邮箱', mailboxCount],
    ['路由规则', ruleCount],
    ['DNS 记录', dnsCount],
    ['已推送', dnsPushed],
    ['审计日志', logCount],
  ]

  return (
    <main className="wrap dashboard-page">
      <header className="dashboard-heading">
        <div>
          <p className="dashboard-eyebrow">CLOVER MAIL · OVERVIEW</p>
          <h1>邮局总览</h1>
          <p className="dashboard-intro">管理域名、邮箱与投递状态。</p>
        </div>
        <Link className="dashboard-secondary" href="/domains/new">＋ 添加域名</Link>
      </header>

      <section className="dashboard-primary" aria-labelledby="cloudflare-title">
        <div className="dashboard-primary-copy">
          <span className="dashboard-kicker"><span className="status-dot" /> DNS · CLOUDFLARE</span>
          <h2 id="cloudflare-title">Cloudflare 连接</h2>
          <p>生成并推送邮件所需的 DNS 记录，随后检查解析状态。</p>
        </div>
        <Link className="dashboard-primary-link" href="/cloudflare">管理连接 <span aria-hidden="true">→</span></Link>
      </section>

      <section className="dashboard-stats" aria-label="邮局数据">
        {stats.map(([l, v]) => (
          <div className="dashboard-stat" key={l}>
            <div className="dashboard-stat-label">{l}</div>
            <div className={'dashboard-stat-value' + (v === 0 ? ' is-zero' : '')}>{v}<span>{l === '域名' || l === '邮箱' ? '个' : '条'}</span></div>
          </div>
        ))}
      </section>

      <section className="panel dashboard-service">
        <div className="section-title"><h2>邮件服务</h2><span className={'tag ' + (dms.state === 'up' ? 'ok' : 'err')}>
          {dms.state === 'up' ? 'supervisord 在线' : '未连接'}
        </span></div>
        <p className="hint">docker-mailserver 状态。未连接时请检查服务器上的邮件服务容器。</p>
        {dms.state === 'up' && <pre className="services">{dms.detail}</pre>}
      </section>

      <div className="dashboard-lower">
        <section className="panel dashboard-domains">
          <div className="section-title"><h2>最近域名</h2><Link href="/domains" className="dashboard-text-link">查看全部 →</Link></div>
          {domainRows.length > 0 ? <ul className="dashboard-domain-list">
            {domainRows.map((d) => <li key={d.id}><span className="mono">{d.name}</span><Link className="dashboard-text-link" href={`/domains/${d.id}`}>管理 →</Link></li>)}
          </ul> : <p className="empty">还没有域名。添加域名后，可在 Cloudflare 连接页同步邮件 DNS。</p>}
        </section>

        <section className="panel dashboard-activity">
          <div className="section-title"><h2>最近动态</h2><span className="count">最近 {recentLogs.length} 条</span></div>
          {recentLogs.length > 0 ? (
            <div className="table-scroll"><table className="grid">
              <thead><tr><th>时间</th><th>操作</th><th>对象</th><th>操作人</th></tr></thead>
              <tbody>{recentLogs.map((l) => <tr key={l.id}><td className="hint-text">{new Date(l.createdAt).toLocaleString('zh-CN')}</td><td>{label(l.action)}</td><td className="mono">{l.target ?? '—'}</td><td className="hint-text">{l.actor}</td></tr>)}</tbody>
            </table></div>
          ) : <p className="empty">还没有操作记录。</p>}
        </section>
      </div>
    </main>
  )
}
