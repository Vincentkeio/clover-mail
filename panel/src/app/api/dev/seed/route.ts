import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { auditLogs, dnsRecords, domains, mailboxes, routingRules } from '@/db/schema'
import { audit } from '@/lib/audit'
import { getMailHostname, setSetting } from '@/lib/settings'
import { generateDnsRecords, absoluteName } from '@/lib/dns-generator'

export const dynamic = 'force-dynamic'

/**
 * 演示数据种子（本地预览 / 演示用）。
 * 守卫：必须显式设置 ALLOW_SEED=true，避免误灌生产库。
 */
export async function POST() {
  if (process.env.ALLOW_SEED !== 'true') {
    return NextResponse.json({ error: '种子接口未启用（需要 ALLOW_SEED=true）' }, { status: 403 })
  }

  await setSetting('vps_ip', '203.0.113.10')
  await setSetting('dmarc_policy', 'none')
  await setSetting('spf_strict', 'false')

  const demoDkim = `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA${'demo'.repeat(20).slice(0, 200)}`

  const summary: Record<string, unknown> = {}

  // ---- 演示域名 ----
  let [domain] = await db.select().from(domains).where(eq(domains.name, 'demo.example.com')).limit(1)
  if (!domain) {
    ;[domain] = await db
      .insert(domains)
      .values({
        name: 'demo.example.com',
        ownershipToken: 'clover-verification=demo000000000000',
        mailHostname: 'mail.demo.example.com',
      })
      .returning()
    summary.domain = 'created'
  } else {
    summary.domain = 'exists'
  }

  // ---- 邮箱 ----
  const boxes = ['boss@demo.example.com', 'postmaster@demo.example.com', 'hello@demo.example.com']
  for (const login of boxes) {
    const [hit] = await db.select().from(mailboxes).where(eq(mailboxes.login, login)).limit(1)
    if (!hit) {
      await db.insert(mailboxes).values({ domainId: domain.id, login, quotaMb: hit === undefined ? 2048 : null })
    }
  }
  summary.mailboxes = boxes

  // ---- 三类规则 ----
  const rules: Array<{ matchType: 'exact' | 'prefix' | 'catchall'; matchValue: string | null; targets: string[]; priority: number }> = [
    { matchType: 'exact', matchValue: 'boss@demo.example.com', targets: ['boss@example.net'], priority: 1 },
    { matchType: 'prefix', matchValue: 'sales', targets: ['boss@example.net', 'hello@example.net'], priority: 10 },
    { matchType: 'catchall', matchValue: null, targets: ['boss@demo.example.com'], priority: 100 },
  ]
  for (const r of rules) {
    const key = `${r.matchType}:${r.matchValue ?? ''}`
    const existing = await db.select().from(routingRules).where(eq(routingRules.domainId, domain.id))
    if (!existing.some((x) => `${x.matchType}:${x.matchValue ?? ''}` === key)) {
      await db.insert(routingRules).values({
        domainId: domain.id,
        matchType: r.matchType,
        matchValue: r.matchValue,
        targets: JSON.stringify(r.targets),
        priority: r.priority,
      })
    }
  }
  summary.rules = rules.length

  // ---- DNS 记录（无 DMS，用演示公钥占位） ----
  const specs = generateDnsRecords({
    domain: domain.name,
    mailHostname: getMailHostname(domain.mailHostname ?? `mail.${domain.name}`),
    ownershipToken: domain.ownershipToken ?? 'clover-verification=demo000000000000',
    vpsIp: '203.0.113.10',
    dkimPublicKey: demoDkim,
    dmarcPolicy: 'none',
    spfStrict: false,
  })
  await db.delete(dnsRecords).where(eq(dnsRecords.domainId, domain.id))
  await db.insert(dnsRecords).values(
    specs.map((s) => ({
      domainId: domain.id,
      type: s.type,
      name: s.name,
      content: s.content,
      priority: s.priority ?? null,
      ttl: s.ttl,
      comment: s.cloverTag,
      status: 'planned',
    })),
  )
  summary.dnsRecords = specs.length
  summary.dnsNames = specs.map((s) => `${s.type} ${absoluteName(domain.name, s.name)}`)

  // 演示用 checklist（明确标注演示数据；真机点「立即检测」会覆盖为真实探测结果）
  const simulatedChecklist = {
    items: [
      { key: 'ownership', label: '归属 TXT', ok: true, expected: domain.ownershipToken ?? 'clover-verification=demo000000000000', actual: '(演示数据)' },
      { key: 'mx', label: 'MX 记录', ok: true, expected: 'mail.demo.clover.dev.（优先级 10）', actual: '(演示数据)' },
      { key: 'mail-a', label: 'mail A 记录', ok: true, expected: '203.0.113.10', actual: '(演示数据)' },
      { key: 'spf', label: 'SPF', ok: true, expected: 'v=spf1 … ip4:203.0.113.10', actual: '(演示数据)' },
      { key: 'dkim', label: 'DKIM', ok: true, expected: 'v=DKIM1; k=rsa; p=…', actual: '(演示数据)' },
      { key: 'dmarc', label: 'DMARC', ok: true, expected: 'v=DMARC1; …', actual: '(演示数据)' },
    ],
    checkedAt: new Date().toISOString(),
  }
  await db.update(domains).set({ dnsStatus: JSON.stringify(simulatedChecklist) }).where(eq(domains.id, domain.id))

  // ---- 审计样例 ----
  await db.insert(auditLogs).values([
    { actor: 'demo', action: 'seed', target: domain.name, detail: JSON.stringify(summary) },
    { actor: 'demo', action: 'auth.login_failed', target: '(demo)', detail: null },
    { actor: 'demo', action: 'dns.generate', target: domain.name, detail: JSON.stringify({ count: specs.length }) },
  ])

  await audit('seed', 'dev.seed', domain.name, summary)
  return NextResponse.json({ ok: true, summary, demoPasswordNote: '演示账号由安装流程创建；DEMO_MODE 下无需登录' })
}
