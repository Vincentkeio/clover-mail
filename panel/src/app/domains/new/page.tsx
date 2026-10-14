import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc, desc, sql } from 'drizzle-orm'
import { db } from '@/db'
import { auditLogs, dnsRecords, domains, mailboxes, routingRules } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'
import { supervisorStatus } from '@/lib/dms'
import NewDomainWizard from './new-domain-wizard'

export const dynamic = 'force-dynamic'

export default async function NewDomainPage() {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')

  return (
    <main className="wrap">
      <div className="topbar">
        <span className="logo">🍀</span>
        <h1>新建域名</h1>
        <span className="tag">三步：填域名 → 看 DNS → 确认</span>
      </div>
      <NewDomainWizard />
      <p className="hint">
        <Link href="/domains">← 返回域名列表</Link>
      </p>
    </main>
  )
}
