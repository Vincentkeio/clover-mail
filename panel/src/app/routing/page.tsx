import { redirect } from 'next/navigation'
import { asc } from 'drizzle-orm'
import { db } from '@/db'
import { domains, routingRules } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'
import RoutingManager from './routing-manager'

export const dynamic = 'force-dynamic'

export default async function RoutingPage() {
  if (!await getCurrentAdmin()) redirect('/login')
  const [domainRows, ruleRows] = await Promise.all([
    db.select().from(domains).orderBy(asc(domains.name)),
    db.select().from(routingRules).orderBy(asc(routingRules.domainId), asc(routingRules.priority), asc(routingRules.id)),
  ])
  return <RoutingManager
    domains={domainRows.map((domain) => ({ id: domain.id, name: domain.name, active: domain.active }))}
    rules={ruleRows.map((rule) => ({ id: rule.id, domainId: rule.domainId, matchType: rule.matchType, matchValue: rule.matchValue, targets: rule.targets, priority: rule.priority, active: rule.active }))}
  />
}
