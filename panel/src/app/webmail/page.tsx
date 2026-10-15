import { redirect } from 'next/navigation'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { domains, mailboxes } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export default async function WebmailPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')
  const { error } = await searchParams
  const boxes = await db.select({ login: mailboxes.login }).from(mailboxes)
    .innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(and(eq(mailboxes.active, true), eq(domains.active, true))).orderBy(asc(mailboxes.id))
  return <main className="wrap"><div className="topbar"><div><p className="eyebrow">MAIL</p><h1>Roundcube Webmail</h1><p className="hint">选择邮箱，通过面板授权在新标签页免密打开完整邮件客户端。</p></div></div>
    {error === 'sso' && <p className="msg err" role="alert">Roundcube 免密登录失败，请检查邮件服务状态后重新进入。</p>}
    <section className="panel"><h2>打开邮箱</h2>{boxes.length ? <form action="/api/v1/roundcube/sso" method="post" target="_blank" rel="noopener" className="form-row"><div className="field"><label htmlFor="roundcube-login">邮箱账户</label><select id="roundcube-login" name="login">{boxes.map((box) => <option key={box.login} value={box.login}>{box.login}</option>)}</select></div><button type="submit" className="primary">进入 Roundcube →</button></form> : <p className="empty">没有已启用的邮箱，请先创建邮箱账户。</p>}</section>
  </main>
}
