import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const createdAt = () => text('created_at').notNull().$defaultFn(() => new Date().toISOString())

export const authRateLimits = sqliteTable('auth_rate_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

export const authChallenges = sqliteTable('auth_challenges', {
  key: text('key').primaryKey(),
  username: text('username').notNull(),
  purpose: text('purpose').notNull(),
  challenge: text('challenge').notNull(),
  credentialVersion: text('credential_version').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

/**
 * 面板管理员（M4：argon2 密码 + TOTP + WebAuthn Passkey）
 */
export const admins = sqliteTable('admins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash'),
  webauthnCredentials: text('webauthn_credentials'), // JSON: WebAuthn Credential[]
  totpSecret: text('totp_secret'),
  totpLastUsedStep: integer('totp_last_used_step'),
  lastLoginAt: text('last_login_at'),
  createdAt: createdAt(),
})

/**
 * 域名（建域即生成全套 DNS + checklist，见 docs/plan.md 6.3/6.4）
 */
export const domains = sqliteTable('domains', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  ownershipToken: text('ownership_token'), // TXT 归属验证 token
  cfZoneId: text('cf_zone_id'), // Cloudflare zone_id（M2）
  dnsStatus: text('dns_status'), // JSON: checklist 逐项打勾状态（M2）
  mailHostname: text('mail_hostname'), // 默认 mail.<domain>
  quotaPolicyMb: integer('quota_policy_mb'), // 域级默认配额
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
})

/**
 * 邮箱（面板 CRUD → docker exec setup CLI 落地到 postfix-accounts.cf）
 */
export const mailboxes = sqliteTable(
  'mailboxes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    domainId: integer('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    login: text('login').notNull().unique(), // 完整邮箱地址
    passwordHash: text('password_hash'),
    quotaMb: integer('quota_mb'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({ domainIdx: index('idx_mailboxes_domain').on(t.domainId) }),
)

/**
 * 四类路由规则（对标 PurelyMail）：exact 精确 / prefix 前缀 / nonuser 非用户 / catchall
 * PurelyMail 语义：规则优先于真实用户，命中后转发到 targets（多目标）
 */
export const routingRules = sqliteTable(
  'routing_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    domainId: integer('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    matchType: text('match_type').notNull(), // exact | prefix | nonuser | catchall
    matchValue: text('match_value'), // exact: 全地址; prefix: sales 类前缀; 其余为 null
    targets: text('targets').notNull(), // JSON: 转发目标数组（逗号分隔源形式 -> JSON）
    priority: integer('priority').notNull().default(100), // 越小越优先
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({ domainIdx: index('idx_routing_domain').on(t.domainId) }),
)

/**
 * DNS 记录（生成器产物 + CF 推送状态回写，M2）
 */
export const dnsRecords = sqliteTable(
  'dns_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    domainId: integer('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // MX/A/TXT/CNAME/SRV
    name: text('name').notNull(), // 相对名：@ / mail / _dmarc / mail._domainkey
    content: text('content').notNull(),
    priority: integer('priority'), // MX/SRV 用
    ttl: integer('ttl').notNull().default(300), // CF 侧 1=自动，此处存具体秒数
    comment: text('comment'),
    cfRecordId: text('cf_record_id'), // 推送后回写（M2）
    status: text('status').notNull().default('planned'), // planned/pushed/error/disabled
    pushedAt: text('pushed_at'),
    createdAt: createdAt(),
  },
  (t) => ({
    domainIdx: index('idx_dns_domain').on(t.domainId),
    keyIdx: index('idx_dns_key').on(t.domainId, t.type, t.name),
  }),
)

/**
 * 键值设置（VPS IP、CF Token、面板 URL 等；sensitive 项加密存储，M2）
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  sensitive: integer('sensitive', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

/**
 * 审计日志（开放 API token 的一切动作也记这里，见 plan 6.7）
 */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actor: text('actor').notNull(), // admin | system | cron | api:<token name>
    action: text('action').notNull(), // domain.create / mailbox.update ...
    target: text('target'), // 作用对象，如域名或 login
    detail: text('detail'), // JSON
    createdAt: createdAt(),
  },
  (t) => ({ timeIdx: index('idx_audit_time').on(t.createdAt) }),
)

/**
 * 开放 API token（M5）：面板所有 /api/v1 端点都能用 Bearer 调用。
 * 只存 sha256 哈希；明文仅在创建时展示一次。
 */
export const apiTokens = sqliteTable('api_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(), // 展示用前缀（clover_xxxxxxxx…）
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
  createdAt: createdAt(),
})
