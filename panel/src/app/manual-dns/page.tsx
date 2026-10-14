import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc } from 'drizzle-orm'
import { db } from '@/db'
import { domains } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function ManualDnsPage() {
  if (!await getCurrentAdmin()) redirect('/login')
  const rows = await db.select().from(domains).orderBy(asc(domains.name))
  return <main className="wrap"><div className="topbar"><div><p className="eyebrow">ADVANCED / DNS</p><h1>手动 DNS</h1><p className="hint">适用于不使用 Cloudflare 连接的域名。可直接下载 DNS 文件，或进入域名详情检查公网解析。</p></div></div>
    <section className="panel"><div className="section-title"><h2>域名记录</h2><span className="count">{rows.length} 个</span></div>
      {rows.length ? <div className="manual-dns-list">{rows.map((domain) => <div className="manual-dns-row" key={domain.id}><div><b className="mono">{domain.name}</b><p className="hint">MX · SPF · DKIM · DMARC · 归属验证</p></div><div className="manual-dns-actions"><Link className="btn-link" href={`/domains/${domain.id}?tab=dns`}>查看 DNS</Link><a className="btn-link" href={`/api/v1/domains/${domain.id}/dns/export?format=bind`}>导出 BIND</a><a className="btn-link" href={`/api/v1/domains/${domain.id}/dns/export?format=text`}>导出文本</a></div></div>)}</div>
        : <p className="empty">先在<Link href="/domains">域名配置</Link>添加域名。</p>}
    </section>
    <p className="hint">手动维护记录时，可在<Link href="/settings#dns-mode">高级参数</Link>中选择手动 DNS 模式。邮件域名的 DNS 状态仍会通过公网检查。</p>
  </main>
}
