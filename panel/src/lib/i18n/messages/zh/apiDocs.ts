const apiDocs = {
  title: 'API 文档',
  tagline: '面板即 API',
  authTitle: '认证',
  authLead: '所有',
  authBody: '端点支持两种认证：面板登录 session cookie，或开放 API token ——',
  authBodyAfterToken: '（在「设置 → 开放 API Token」生成）。Token 等同于管理员凭证，请像密码一样保管；吊销即刻生效。',
  errorFormatLead: '响应均为 JSON；错误格式',
  errorFormatSample: '{ "error": "描述" }',
  errorFormatBody: '；常用状态码：400 参数错误 · 401 未认证 · 404 不存在 · 409 冲突（重复）· 422 语义不合法 · 502 上游（DMS/CF）失败。一切变更都会写审计日志（actor 记为',
  auditActor: 'api:<token 名>',
  errorFormatEnd: '）。',
  colMethod: '方法',
  colPath: '路径',
  colDescription: '说明',
  goGenerateToken: '← 去生成 API token',

  groupDomains: '域名',
  groupMailboxes: '邮箱',
  groupRules: '路由规则（四类）',
  groupDns: 'DNS（Cloudflare）',
  groupMonitor: '监控与系统',
  groupCloudflare: 'Cloudflare 连接（填一次 Token，批量管理 DNS）',
  groupSettings: '设置',

  domainsList: '域名列表（含邮箱/规则计数）',
  domainsCreate: '建域；body: {"name":"example.com","quotaPolicyMb"?:number}。邮件主机名统一从安装配置读取。',
  domainsDetail: '域详情（含邮箱与规则）',
  domainsUpdate: '更新域配额与启用状态；邮件主机名由安装配置统一管理。',
  domainsDelete: '删域；级联清理 DMS 账号与 alias',

  mailboxesList: '某域的邮箱列表',
  mailboxesCreate: '建邮箱；body: {"login":"a@example.com","password":"≥10位","quotaMb"?:number}',
  mailboxesUpdate: '改密 / 配额 / 停用',
  mailboxesDelete: '删邮箱（DMS 同步清理）',

  rulesList: '规则列表',
  rulesCreate: 'matchType: exact|prefix|nonuser|catchall；targets 逗号分隔或数组；priority 越小越优先',
  rulesUpdate: '更新 targets / priority / active',
  rulesDelete: '删规则（DMS alias 与 prefix 正则表同步）',

  dnsList: '记录列表 + 生成预览 + 上次检测结果',
  dnsGenerate: '生成 / 刷新 DNS 记录（入库）',
  dnsPush: '推送到 Cloudflare（diff → batch，幂等）',
  dnsCheck: '公网 DoH 检测 checklist',
  dnsExport: '导出 BIND / TXT（均可导入 DNS）',
  dnsPreview: '建域前的记录预览',

  spamStats: 'rspamd 统计（符号 TopN / 动作分布）',
  queueStatus: '队列 + 服务进程 + 日志尾部',
  deliverability: 'DNSBL 黑名单 + 域健康体检',
  reconcile: '对账；body {"heal":true} 才自动修复',
  backup: '下载一致性备份（SQLite 快照 / DMS 配置 tar）',
  tokensList: 'API token 列表',
  tokensCreate: '创建 token（明文仅返回一次）',
  tokensRevoke: '吊销 token',

  cfZones: '列出 Token 可见的全部域名（zone），标注是否已导入面板',
  cfImport: '批量导入：body {"names":["a.com"] | "all", "push":true} → 建域 + 生成记录 + 推送',
  cfPushAll: '把面板内所有已建域重新生成并推送（幂等）',

  settingsGet: '读取面板设置（隐藏敏感值）',
  settingsUpdate: '更新面板参数与全局邮箱策略（协议、远程内容和附件限制）',
  settingsCheck: 'CF token 连通性自检（body {"domain":"example.com"}）',
  settingsDelete: '清除 CF Token',
  health: '健康检查（无需认证）',

  sampleDomainsCreate: `curl -X POST https://panel.example.com/api/v1/domains \\
  -H "Authorization: Bearer clover_xxx" -H 'Content-Type: application/json' \\
  -d '{"name":"example.com"}'`,
  sampleRulesCreate: `curl -X POST https://panel.example.com/api/v1/domains/1/rules \\
  -H "Authorization: Bearer clover_xxx" -H 'Content-Type: application/json' \\
  -d '{"matchType":"catchall","targets":"me@gmail.com"}'`,
  sampleDnsPush: `curl -X POST https://panel.example.com/api/v1/domains/1/dns/push \\
  -H "Authorization: Bearer clover_xxx"`,
  sampleReconcile: `curl -X POST https://panel.example.com/api/v1/system/reconcile \\
  -H "Authorization: Bearer clover_xxx" -H 'Content-Type: application/json' -d '{"heal":false}'`,
  sampleCfImport: `# 把 CF 账号下所有域名一次性导入并配好 DNS
curl -X POST https://panel.example.com/api/v1/cloudflare/import \\
  -H "Authorization: Bearer clover_xxx" -H 'Content-Type: application/json' \\
  -d '{"names":"all","push":true}'`,
}

export default apiDocs
