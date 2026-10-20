const dashboard = {
  actionDomainCreate: 'Domain created',
  actionDomainDelete: 'Domain deleted',
  actionMailboxCreate: 'Mailbox created',
  actionMailboxDelete: 'Mailbox deleted',
  actionRuleCreate: 'Routing rule created',
  actionRuleDelete: 'Routing rule deleted',
  actionDnsGenerate: 'DNS records generated',
  actionDnsPush: 'Pushed to Cloudflare',
  actionDnsCheck: 'DNS check',
  actionRoundcubeOpen: 'Roundcube sign-in',
  actionSettingsUpdate: 'Settings updated',
  actionAuthLogin: 'Panel sign-in',
  actionSystemReconcile: 'Reconcile',
  actionSeed: 'Seed',

  statDomains: 'Domains',
  statMailboxes: 'Mailboxes',
  statRules: 'Routing rules',
  statDns: 'DNS records',
  statPushed: 'Pushed',
  statLogs: 'Audit logs',
  unitCount: '',
  unitItem: '',

  title: 'Mail overview',
  intro: 'Manage domains, mailboxes and delivery status.',
  addDomain: '＋ Add domain',
  statsLabel: 'Mail statistics',

  cloudflareTitle: 'Cloudflare connection',
  cloudflareBody: 'Generate and push the DNS records required for mail, then check resolution status.',
  cloudflareLink: 'Manage connection',

  mailServiceTitle: 'Mail service',
  mailServiceUp: 'supervisord online',
  mailServiceDown: 'Not connected',
  mailServiceHint: 'docker-mailserver status. If it is not connected, check the mail service container on the server.',

  recentDomains: 'Recent domains',
  viewAll: 'View all →',
  dnsSettings: 'DNS settings →',
  noDomains: 'No domains yet. Add a domain, then sync mail DNS on the Cloudflare connection page.',

  recentActivity: 'Recent activity',
  activityCount: 'Last {count}',
  colTarget: 'Target',
  colActor: 'Actor',
  noActivity: 'No activity yet.',
}

export default dashboard
