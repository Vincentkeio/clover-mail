const domains = {
  title: '域名配置',
  intro: '添加邮件域名、查看归属验证信息，并管理域名启用状态。DNS 记录请到“DNS 设置”管理。',
  countHint: '{count} 个域名',
  addTitle: '添加域名',
  addHint: '添加后可在“DNS 设置”中生成、同步并检查 MX、SPF、DKIM 与 DMARC 记录。',
  empty: '还没有域名，先在上方添加第一个。',
  colMailHostname: '邮件主机名',
  colMailboxes: '邮箱',
  colRules: '规则',
  colOwnership: '归属验证 TXT',
  requestFailed: '操作失败，请稍后重试。',
  confirmDisable: '停用 {name}？该域的客户端登录与发信将暂停，新邮件会被暂时拒收；重新启用后恢复。',
  toggleFailed: '状态更改失败。',
  confirmDelete: '确定删除 {name}？将同时删除 {mailboxes} 个邮箱及其中的邮件数据、{rules} 条转发规则。Cloudflare DNS 记录不会自动删除。此操作无法撤销。',
  policySyncFailed: '域名已删除，但邮件服务策略未能同步：{error}',
  deleteFailed: '删除失败。',
  applying: '应用中…',
  deleting: '删除中…',
  disableAria: '停用 {name}',
  enableAria: '启用 {name}',
}

export default domains
