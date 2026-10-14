import type { CfRecordInput } from './cloudflare'

/** clover 生成的邮局 DNS 记录（content 未加尾点，落在库/导出前统一处理） */
export type DnsRecordSpec = {
  type: 'MX' | 'A' | 'TXT' | 'CNAME' | 'SRV'
  /** 相对名：@ / mail / _dmarc / mail._domainkey / autoconfig */
  name: string
  content: string
  ttl: number
  priority?: number
  /** 写进 CF comment，用于识别 clover 托管记录（推送幂等的关键） */
  cloverTag: string
  /** 记录用途说明（展示用） */
  purpose: string
}

export type GenerateDnsOptions = {
  domain: string
  mailHostname: string
  ownershipToken: string
  vpsIp: string
  dkimPublicKey?: string | null
  dmarcPolicy?: 'none' | 'quarantine' | 'reject'
  /** SPF 硬失败（-all）还是软失败（~all）；未验证阶段建议 ~all */
  spfStrict?: boolean
  /** 进阶记录：autoconfig / MTA-STS / TLS-RPT，默认关 */
  advanced?: boolean
}

/** DNS MX 记录优先级 */
export const MX_PRIORITY = 10

export function generateDnsRecords(opts: GenerateDnsOptions): DnsRecordSpec[] {
  const { domain, mailHostname, ownershipToken, vpsIp, dkimPublicKey, dmarcPolicy = 'quarantine' } = opts
  const spfAll = opts.spfStrict === false ? '~all' : '-all'
  const at = `@`

  const records: DnsRecordSpec[] = [
    {
      type: 'TXT',
      name: at,
      content: ownershipToken,
      ttl: 300,
      cloverTag: 'clover-ownership',
      purpose: '域名归属验证',
    },
    {
      type: 'MX',
      name: at,
      // CF 要求指向域名的 content 为 FQDN（尾点）
      content: `${mailHostname}.`,
      ttl: 300,
      priority: MX_PRIORITY,
      cloverTag: 'clover-mx',
      purpose: '邮件交换（入站投递）',
    },
    {
      type: 'TXT',
      name: at,
      content: `v=spf1 a mx ip4:${vpsIp} ${spfAll}`,
      ttl: 300,
      cloverTag: 'clover-spf',
      purpose: 'SPF 发信授权',
    },
    {
      type: 'TXT',
      name: '_dmarc',
      content: `v=DMARC1; p=${dmarcPolicy}; rua=mailto:dmarc@${domain}; fo=1`,
      ttl: 300,
      cloverTag: 'clover-dmarc',
      purpose: 'DMARC 策略',
    },
  ]

  // 邮件服务统一使用一个主机名和证书。只在该主机名所属的 DNS zone
  // 创建 A 记录，其他邮件域名只创建指向该主机名的 MX。
  const normalizedDomain = domain.toLowerCase().replace(/\.$/, '')
  const normalizedMailHost = mailHostname.toLowerCase().replace(/\.$/, '')
  if (normalizedMailHost === normalizedDomain || normalizedMailHost.endsWith(`.${normalizedDomain}`)) {
    const relativeName = normalizedMailHost === normalizedDomain
      ? '@'
      : normalizedMailHost.slice(0, -(normalizedDomain.length + 1))
    records.splice(1, 0, {
      type: 'A',
      name: relativeName,
      content: vpsIp,
      ttl: 300,
      cloverTag: 'clover-mail-a',
      purpose: '邮件主机 A 记录',
    })
  }

  if (dkimPublicKey) {
    records.push({
      type: 'TXT',
      name: `mail._domainkey`,
      // CF API 接受完整公钥单条 content（自动分片存储）；BIND 导出时才手动 255 分片
      content: dkimPublicKey.trim(),
      ttl: 300,
      cloverTag: 'clover-dkim',
      purpose: 'DKIM 公钥',
    })
  }

  if (opts.advanced) {
    records.push(
      {
        type: 'CNAME',
        name: 'autoconfig',
        content: `${mailHostname}.`,
        ttl: 300,
        cloverTag: 'clover-autoconfig',
        purpose: '客户端自动配置（Thunderbird 等）',
      },
      {
        type: 'CNAME',
        name: '_mta-sts',
        content: `${mailHostname}.`,
        ttl: 300,
        cloverTag: 'clover-mta-sts',
        purpose: 'MTA-STS 策略主机',
      },
      {
        type: 'TXT',
        name: '_mta-sts',
        content: `v=STSv1; id=${new Date().toISOString().slice(0, 10)}`,
        ttl: 300,
        cloverTag: 'clover-mta-sts-txt',
        purpose: 'MTA-STS 策略标识',
      },
      {
        type: 'TXT',
        name: '_smtp._tls',
        content: 'v=TLSRPTv1; rua=mailto:tls-report@' + domain,
        ttl: 300,
        cloverTag: 'clover-tls-rpt',
        purpose: 'TLS-RPT 报告',
      },
    )
  }

  return records
}

/** 相对名 + 域名 → CF 用的绝对名 */
export function absoluteName(domain: string, name: string): string {
  return name === '@' ? domain : `${name}.${domain}`
}

export function toCfInput(domain: string, spec: DnsRecordSpec): CfRecordInput {
  return {
    type: spec.type,
    name: absoluteName(domain, spec.name),
    content: spec.content,
    ttl: 1, // CF 侧 1 = 自动
    priority: spec.priority,
    proxied: false, // 邮件相关记录一律不代理
    comment: spec.cloverTag,
  }
}

/** 相同 (type, name, cloverTag) 即同一记录的匹配键 */
export function recordKey(type: string, name: string, tag: string): string {
  return `${type}|${name}|${tag}`
}

export type DnsDiff = {
  posts: CfRecordInput[]
  patches: Array<{ id: string } & Partial<CfRecordInput>>
  deletes: Array<{ id: string }>
}

/**
 * diff：面板生成的记录 vs CF 现状。
 * - 托管识别靠 comment（cloverTag 精确匹配）
 * - 同名同型但 comment 非本组的存量 clover 记录 → 删除（废弃托管项）
 */
export function diffAgainstExisting(
  domain: string,
  specs: DnsRecordSpec[],
  existing: Array<CfRecordInput & { id: string }>,
): DnsDiff {
  const existingByKey = new Map(existing.map((r) => [recordKey(r.type, r.name, r.comment ?? ''), r]))
  const wantedKeys = new Set(specs.map((s) => recordKey(s.type, absoluteName(domain, s.name), s.cloverTag)))

  const posts: CfRecordInput[] = []
  const patches: DnsDiff['patches'] = []

  for (const spec of specs) {
    const input = toCfInput(domain, spec)
    const hit = existingByKey.get(recordKey(input.type, input.name, spec.cloverTag))
    if (!hit) {
      posts.push(input)
    } else if (
      hit.content !== input.content ||
      (hit.priority ?? undefined) !== input.priority ||
      (hit.ttl ?? undefined) !== input.ttl
    ) {
      patches.push({ id: hit.id, content: input.content, priority: input.priority, ttl: input.ttl })
    }
  }

  // CF 上带 clover 注释、但本次不在生成集里的记录 → 清理
  const deletes = existing
    .filter((r) => (r.comment ?? '').startsWith('clover') && !wantedKeys.has(recordKey(r.type, r.name, r.comment ?? '')))
    .map((r) => ({ id: r.id }))

  return { posts, patches, deletes }
}

/** BIND zone 文件导出（粘到 CF Import and Export 手动导入用；DKIM 按 255 字符分片） */
export function exportBind(domain: string, specs: DnsRecordSpec[], defaultTtl = 300): string {
  const lines = [
    `; clover 邮局 DNS 导出 — ${domain}`,
    `; 生成时间 ${new Date().toISOString()}`,
    `; 导入：Cloudflare → DNS -> Import and Export`,
    `$ORIGIN ${domain}.`,
    `$TTL ${defaultTtl}`,
    '',
  ]

  for (const spec of specs) {
    const name = spec.name === '@' ? '@' : spec.name
    const ttl = spec.ttl || defaultTtl
    if (spec.type === 'MX' || spec.type === 'SRV') {
      lines.push(`${name}\t${ttl}\tIN\t${spec.type}\t${spec.priority ?? 10} ${spec.content}`)
    } else if (spec.type === 'TXT' && spec.content.length > 255) {
      // BIND 需要分片；CF API 不需要
      const chunks: string[] = []
      let rest = spec.content
      while (rest.length > 255) {
        chunks.push(rest.slice(0, 255))
        rest = rest.slice(255)
      }
      chunks.push(rest)
      const quoted = chunks.map((c) => `"${c}"`).join(' ')
      lines.push(`${name}\t${ttl}\tIN\tTXT\t${quoted}`)
    } else if (spec.type === 'TXT') {
      lines.push(`${name}\t${ttl}\tIN\tTXT\t"${spec.content}"`)
    } else {
      lines.push(`${name}\t${ttl}\tIN\t${spec.type}\t${spec.content}`)
    }
    lines.push(`; ${spec.purpose}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** 纯文本清单（兜底：发给域名商手工加记录） */
export function exportPlain(domain: string, specs: DnsRecordSpec[]): string {
  const lines = [`# clover 邮局 DNS 清单 — ${domain}`]
  for (const spec of specs) {
    const name = absoluteName(domain, spec.name)
    const pri = spec.priority !== undefined ? `\t优先级 ${spec.priority}` : ''
    lines.push(`${spec.type}\t${name}\t${spec.content}${pri}\t; ${spec.purpose}`)
  }
  return lines.join('\n')
}
