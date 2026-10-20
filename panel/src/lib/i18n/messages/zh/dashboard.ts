const dashboard = {
  actionDomainCreate: '建域',
  actionDomainDelete: '删域',
  actionMailboxCreate: '建邮箱',
  actionMailboxDelete: '删邮箱',
  actionRuleCreate: '建规则',
  actionRuleDelete: '删规则',
  actionDnsGenerate: '生成 DNS',
  actionDnsPush: '推送 CF',
  actionDnsCheck: 'DNS 检测',
  actionRoundcubeOpen: 'Roundcube 登录',
  actionSettingsUpdate: '改设置',
  actionAuthLogin: '登录面板',
  actionSystemReconcile: '对账',
  actionSeed: '种子',

  statDomains: '域名',
  statMailboxes: '邮箱',
  statRules: '路由规则',
  statDns: 'DNS 记录',
  statPushed: '已推送',
  statLogs: '审计日志',
  unitCount: '个',
  unitItem: '条',

  title: '邮局总览',
  intro: '管理域名、邮箱与投递状态。',
  addDomain: '＋ 添加域名',
  statsLabel: '邮局数据',

  cloudflareTitle: 'Cloudflare 连接',
  cloudflareBody: '生成并推送邮件所需的 DNS 记录，随后检查解析状态。',
  cloudflareLink: '管理连接',

  mailServiceTitle: '邮件服务',
  mailServiceUp: 'supervisord 在线',
  mailServiceDown: '未连接',
  mailServiceHint: 'docker-mailserver 状态。未连接时请检查服务器上的邮件服务容器。',

  recentDomains: '最近域名',
  viewAll: '查看全部 →',
  dnsSettings: 'DNS 设置 →',
  noDomains: '还没有域名。添加域名后，可在 Cloudflare 连接页同步邮件 DNS。',

  recentActivity: '最近动态',
  activityCount: '最近 {count} 条',
  colTarget: '对象',
  colActor: '操作人',
  noActivity: '还没有操作记录。',
}

export default dashboard
